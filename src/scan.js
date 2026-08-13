'use strict';

/**
 * Skerry — the scanner.
 *
 * This module is pure. It takes a list of repository-relative paths (plus
 * optional git file modes) and returns findings. It never touches the
 * filesystem, never reads file contents, never spawns a process and never
 * looks at the environment. Everything that talks to the outside world lives
 * in sources.js, render.js and index.js.
 *
 * Purity is what makes the failing fixtures possible: Skerry's own repository
 * must stay clonable on Windows and macOS, so the hazardous examples are path
 * *manifests*, not real files. The scanner cannot tell the difference.
 */

const {
  RULES,
  SEVERITY_RANK,
  WINDOWS_RESERVED,
  WINDOWS_ILLEGAL_CHARS,
  isBidiControl,
  isInvisibleFormat,
  isControlChar,
} = require('./constants');
const { matchesAny } = require('./match');

const DEFAULT_MAX_PATH_LENGTH = 200;
const DEFAULT_MAX_FINDINGS = 500;

/** Deterministic ordering: UTF-16 code unit order, no locale involvement. */
function byCodeUnit(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function nfc(s) {
  return s.normalize('NFC');
}

function collisionKey(name) {
  return nfc(name).toLowerCase();
}

/**
 * Build the node tree. Every distinct path prefix becomes one node, so a badly
 * named directory is reported once rather than once per file inside it.
 */
function buildNodes(entries) {
  const nodes = new Map();
  const siblings = new Map(); // parentPath -> Map(collisionKey -> Set(rawName))

  for (const entry of entries) {
    const comps = entry.path.split('/');
    for (let i = 0; i < comps.length; i += 1) {
      const name = comps[i];
      const nodePath = comps.slice(0, i + 1).join('/');
      const parent = i === 0 ? '' : comps.slice(0, i).join('/');
      const isLeaf = i === comps.length - 1;

      let node = nodes.get(nodePath);
      if (!node) {
        node = {
          path: nodePath,
          name,
          parent,
          isLeaf,
          mode: isLeaf ? entry.mode || null : null,
          // `sample` is a real leaf path used to bind annotations to a file
          // that actually exists in the tree.
          sample: entry.path,
        };
        nodes.set(nodePath, node);
      } else if (isLeaf && !node.isLeaf) {
        node.isLeaf = true;
        node.mode = entry.mode || null;
      }

      let group = siblings.get(parent);
      if (!group) {
        group = new Map();
        siblings.set(parent, group);
      }
      const key = collisionKey(name);
      let names = group.get(key);
      if (!names) {
        names = new Set();
        group.set(key, names);
      }
      names.add(name);
    }
  }

  return { nodes, siblings };
}

function joinPath(parent, name) {
  return parent === '' ? name : `${parent}/${name}`;
}

/**
 * Two names that collide only by normalization look identical when printed,
 * which makes the finding useless on its own. Spell out the non-ASCII code
 * points so a reader can see which spelling is which.
 */
function codePointSpelling(name) {
  let out = '';
  for (const ch of name) {
    const cp = ch.codePointAt(0);
    out += cp >= 0x20 && cp <= 0x7e ? ch : `<U+${cp.toString(16).toUpperCase().padStart(4, '0')}>`;
  }
  return out;
}

function classifyCollision(members) {
  const nfcForms = new Set(members.map(nfc));
  if (nfcForms.size === 1) {
    const spellings = members.map((m) => `"${codePointSpelling(m)}"`).join(' vs ');
    return {
      rule: RULES.SK002,
      detail: `These names are identical after Unicode NFC normalization but stored differently: ${spellings}`,
    };
  }
  const lowered = new Set(members.map((m) => m.toLowerCase()));
  if (lowered.size === 1) {
    return { rule: RULES.SK001, detail: 'These names differ only by letter case' };
  }
  return { rule: RULES.SK001, detail: 'These names differ by both letter case and Unicode normalization' };
}

function collisionFindings(nodes, siblings, disabled) {
  const out = [];
  const parents = [...siblings.keys()].sort(byCodeUnit);

  for (const parent of parents) {
    const group = siblings.get(parent);
    const keys = [...group.keys()].sort(byCodeUnit);

    for (const key of keys) {
      const members = [...group.get(key)].sort(byCodeUnit);
      if (members.length < 2) continue;

      const { rule, detail } = classifyCollision(members);
      const memberPaths = members.map((m) => joinPath(parent, m));

      for (let i = 0; i < members.length; i += 1) {
        const nodePath = memberPaths[i];
        const node = nodes.get(nodePath);
        if (!node) continue;
        const related = memberPaths.filter((_, j) => j !== i);

        if (!disabled.has(rule.id)) {
          out.push({
            rule: rule.id,
            name: rule.name,
            severity: rule.severity,
            path: nodePath,
            file: node.sample,
            message: `${rule.summary} Collides with: ${related.join(', ')}. ${detail}.`,
            related,
          });
        }

        // A symlink taking part in a collision is the shape behind documented
        // clone-time hazards. Reported separately so it can be disabled alone.
        if (!disabled.has('SK010') && node.isLeaf && node.mode === '120000') {
          out.push({
            rule: RULES.SK010.id,
            name: RULES.SK010.name,
            severity: RULES.SK010.severity,
            path: nodePath,
            file: node.sample,
            message: `${RULES.SK010.summary} Collides with: ${related.join(', ')}.`,
            related,
          });
        }
      }
    }
  }
  return out;
}

function describeCodePoint(cp) {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

function segmentFindings(nodes, options) {
  const out = [];
  const { disabled, maxPathLength } = options;
  const nodePaths = [...nodes.keys()].sort(byCodeUnit);

  for (const nodePath of nodePaths) {
    const node = nodes.get(nodePath);
    const name = node.name;

    // SK004 — Windows reserved device name
    if (!disabled.has('SK004')) {
      const dot = name.indexOf('.');
      const base = (dot === -1 ? name : name.slice(0, dot)).toUpperCase();
      if (WINDOWS_RESERVED.has(base)) {
        out.push(makeFinding(RULES.SK004, node, `Segment "${name}" uses reserved device name ${base}.`));
      }
    }

    // SK005 — characters Windows cannot store
    if (!disabled.has('SK005')) {
      const bad = new Set();
      for (const ch of name) {
        const cp = ch.codePointAt(0);
        if (WINDOWS_ILLEGAL_CHARS.has(ch)) bad.add(`${describeCodePoint(cp)} ${ch}`);
        else if (isControlChar(cp)) bad.add(describeCodePoint(cp));
      }
      if (bad.size > 0) {
        const list = [...bad].sort(byCodeUnit).join(', ');
        out.push(makeFinding(RULES.SK005, node, `Segment contains illegal character(s): ${list}.`));
      }
    }

    // SK006 — trailing dot or space
    if (!disabled.has('SK006') && (name.endsWith('.') || name.endsWith(' '))) {
      const what = name.endsWith('.') ? 'a dot' : 'a space';
      out.push(makeFinding(RULES.SK006, node, `Segment ends with ${what}, which Windows silently strips.`));
    }

    // SK007 — leading space
    if (!disabled.has('SK007') && name.startsWith(' ')) {
      out.push(makeFinding(RULES.SK007, node, 'Segment begins with a space.'));
    }

    // SK003 — non-NFC name
    if (!disabled.has('SK003') && name !== nfc(name)) {
      out.push(makeFinding(RULES.SK003, node, 'Segment is not in Unicode NFC form.'));
    }

    // SK009 / SK011 — deceptive and invisible characters
    const bidi = new Set();
    const invisible = new Set();
    for (const ch of name) {
      const cp = ch.codePointAt(0);
      if (isBidiControl(cp)) bidi.add(describeCodePoint(cp));
      else if (isInvisibleFormat(cp)) invisible.add(describeCodePoint(cp));
    }
    if (!disabled.has('SK009') && bidi.size > 0) {
      out.push(makeFinding(RULES.SK009, node, `Segment contains ${[...bidi].sort(byCodeUnit).join(', ')}.`));
    }
    if (!disabled.has('SK011') && invisible.size > 0) {
      out.push(makeFinding(RULES.SK011, node, `Segment contains ${[...invisible].sort(byCodeUnit).join(', ')}.`));
    }

    // SK008 — path length, whole leaf paths only
    if (!disabled.has('SK008') && maxPathLength > 0 && node.isLeaf && nodePath.length >= maxPathLength) {
      out.push(
        makeFinding(
          RULES.SK008,
          node,
          `Path is ${nodePath.length} characters, at or above the configured limit of ${maxPathLength}.`
        )
      );
    }
  }

  return out;
}

function makeFinding(rule, node, message) {
  return {
    rule: rule.id,
    name: rule.name,
    severity: rule.severity,
    path: node.path,
    file: node.sample,
    message,
  };
}

function sortFindings(findings) {
  return findings.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (bySeverity !== 0) return bySeverity;
    const byPath = byCodeUnit(a.path, b.path);
    if (byPath !== 0) return byPath;
    const byRule = byCodeUnit(a.rule, b.rule);
    if (byRule !== 0) return byRule;
    return byCodeUnit(a.message, b.message);
  });
}

/**
 * @param {{path: string, mode?: string}[]} entries
 * @param {object} [options]
 * @returns {{findings: array, counts: object, scanned: number, ignored: number, truncated: boolean, total: number}}
 */
function scan(entries, options = {}) {
  const disabled = new Set(options.disable || []);
  const ignore = options.ignore || [];
  const maxPathLength = Number.isInteger(options.maxPathLength)
    ? options.maxPathLength
    : DEFAULT_MAX_PATH_LENGTH;
  const maxFindings = Number.isInteger(options.maxFindings)
    ? options.maxFindings
    : DEFAULT_MAX_FINDINGS;

  const seen = new Set();
  const kept = [];
  let ignored = 0;

  for (const raw of entries) {
    const entry = typeof raw === 'string' ? { path: raw } : raw;
    if (!entry || typeof entry.path !== 'string') continue;
    let p = entry.path;
    if (p.length === 0) continue;
    if (p.includes('\u0000')) continue; // cannot occur in a git path
    if (p.startsWith('./')) p = p.slice(2);
    if (p.startsWith('/')) p = p.slice(1);
    if (p.length === 0) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    if (matchesAny(ignore, p)) {
      ignored += 1;
      continue;
    }
    kept.push({ path: p, mode: entry.mode || null });
  }

  kept.sort((a, b) => byCodeUnit(a.path, b.path));

  const { nodes, siblings } = buildNodes(kept);
  const all = sortFindings([
    ...collisionFindings(nodes, siblings, disabled),
    ...segmentFindings(nodes, { disabled, maxPathLength }),
  ]);

  const counts = { error: 0, warning: 0, notice: 0, total: all.length };
  for (const f of all) counts[f.severity] += 1;

  const truncated = all.length > maxFindings;
  return {
    findings: truncated ? all.slice(0, maxFindings) : all,
    counts,
    scanned: kept.length,
    ignored,
    truncated,
    total: all.length,
  };
}

module.exports = {
  scan,
  buildNodes,
  classifyCollision,
  codePointSpelling,
  byCodeUnit,
  DEFAULT_MAX_PATH_LENGTH,
  DEFAULT_MAX_FINDINGS,
};
