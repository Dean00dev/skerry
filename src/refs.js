'use strict';

const { execFileSync } = require('node:child_process');
const { RULES, WINDOWS_RESERVED, REF_ILLEGAL_CHARS, isControlChar } = require('./constants');

const MAX_REFS = 10000;
const MAX_REF_OUTPUT_BYTES = 16 * 1024 * 1024;
class RefError extends Error {}

function byCodeUnit(a, b) { return a === b ? 0 : (a < b ? -1 : 1); }

function splitRef(value) {
  if (value.startsWith('refs/heads/')) return { namespace: 'branch', name: value.slice(11) };
  if (value.startsWith('refs/tags/')) return { namespace: 'tag', name: value.slice(10) };
  return { namespace: 'ref', name: value };
}

function collectRefs(dir, env = process.env) {
  const refs = new Set();
  const head = typeof env.GITHUB_HEAD_REF === 'string' ? env.GITHUB_HEAD_REF.trim() : '';
  if (head) refs.add(`refs/heads/${head}`);
  if (!head && typeof env.GITHUB_REF_NAME === 'string' && env.GITHUB_REF_NAME.trim()) {
    const type = env.GITHUB_REF_TYPE === 'tag' ? 'tags' : 'heads';
    refs.add(`refs/${type}/${env.GITHUB_REF_NAME.trim()}`);
  }

  let inside = false;
  try {
    inside = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
      maxBuffer: 1024 * 1024,
    }).trim() === 'true';
  } catch { inside = false; }
  if (inside) {
    let output;
    try {
      output = execFileSync('git', ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/tags'], {
        cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
        maxBuffer: MAX_REF_OUTPUT_BYTES,
      });
    } catch (err) {
      throw new RefError(`could not enumerate local refs: ${String(err.message).split('\n')[0].slice(0, 160)}`);
    }
    for (const line of output.split('\n')) {
      const value = line.trim();
      if (value) refs.add(value);
      if (refs.size > MAX_REFS) throw new RefError(`more than ${MAX_REFS} refs were found`);
    }
  }
  return [...refs].sort(byCodeUnit);
}

function describeCodePoint(cp) { return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`; }

function inspectRefName(name) {
  const problems = [];
  const components = name.split('/');
  const reserved = [];
  for (const component of components) {
    const dot = component.indexOf('.');
    const base = (dot === -1 ? component : component.slice(0, dot)).toUpperCase();
    if (WINDOWS_RESERVED.has(base)) reserved.push(component);
  }
  if (reserved.length) problems.push(`uses Windows reserved device name${reserved.length > 1 ? 's' : ''} ${[...new Set(reserved)].sort(byCodeUnit).join(', ')}`);
  const illegal = new Set();
  for (const ch of name) {
    const cp = ch.codePointAt(0);
    if (REF_ILLEGAL_CHARS.has(ch)) illegal.add(`${describeCodePoint(cp)} ${ch}`);
    else if (isControlChar(cp)) illegal.add(describeCodePoint(cp));
  }
  if (illegal.size) problems.push(`contains ${[...illegal].sort(byCodeUnit).join(', ')}, which Windows cannot store`);
  if (components.some((c) => c.endsWith('.') || c.endsWith(' '))) problems.push('has a component ending in a dot or space, which Windows strips');
  return problems;
}

function scanRefs(refs, options = {}) {
  const disabled = new Set(options.disable || []);
  const unique = [...new Set(refs)].sort(byCodeUnit).map((raw) => ({ raw, ...splitRef(raw) }));
  const findings = [];
  if (!disabled.has('SK012')) {
    for (const ref of unique) {
      const problems = inspectRefName(ref.name);
      if (!problems.length) continue;
      findings.push({ rule: 'SK012', name: RULES.SK012.name, severity: RULES.SK012.severity,
        path: `${ref.namespace}:${ref.name}`, file: null, kind: 'ref', refType: ref.namespace,
        message: `${RULES.SK012.summary} The ${ref.namespace} "${ref.name}" ${problems.join('; and ')}.` });
    }
  }
  if (!disabled.has('SK013')) {
    const groups = new Map();
    for (const ref of unique) {
      const key = `${ref.namespace}\u0000${ref.name.normalize('NFC').toLowerCase()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(ref);
    }
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      for (const ref of members) {
        const related = members.filter((item) => item.raw !== ref.raw).map((item) => item.name).sort(byCodeUnit);
        findings.push({ rule: 'SK013', name: RULES.SK013.name, severity: RULES.SK013.severity,
          path: `${ref.namespace}:${ref.name}`, file: null, kind: 'ref', refType: ref.namespace,
          message: `${RULES.SK013.summary} The ${ref.namespace} "${ref.name}" collides with: ${related.join(', ')}.`, related });
      }
    }
  }
  findings.sort((a, b) => byCodeUnit(a.path, b.path) || byCodeUnit(a.rule, b.rule));
  return { findings, scanned: unique.length };
}

module.exports = { collectRefs, inspectRefName, scanRefs, RefError, MAX_REFS, MAX_REF_OUTPUT_BYTES };
