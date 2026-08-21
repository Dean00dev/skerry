'use strict';

/**
 * Skerry — turning findings into output.
 *
 * Everything here handles attacker-influenced text. A path in a pull request
 * is chosen by whoever opened the pull request, so a filename may contain
 * newlines, '::', percent signs, ANSI escapes, or bidirectional overrides.
 *
 * Two separate defences:
 *
 *  1. sanitizeDisplay() replaces every control, bidi and invisible character
 *     with a visible <U+XXXX> placeholder before the text is shown anywhere.
 *     This is what stops terminal escape sequences and log spoofing.
 *  2. escapeData() / escapeProperty() apply GitHub's documented workflow
 *     command escaping. This is what stops a filename from being parsed as a
 *     new workflow command such as ::add-mask:: or ::set-output::.
 *
 * Both are applied. Neither is trusted alone.
 */

const { RULES, SEVERITY } = require('./constants');

const MAX_DISPLAY_LENGTH = 300;
const MAX_SUMMARY_ROWS = 100;

function describeCodePoint(cp) {
  return `<U+${cp.toString(16).toUpperCase().padStart(4, '0')}>`;
}

function isDangerousForDisplay(cp) {
  return (
    cp <= 0x1f || // C0 controls, including ESC, CR, LF, TAB
    cp === 0x7f || // DEL
    (cp >= 0x80 && cp <= 0x9f) || // C1 controls
    cp === 0x061c ||
    (cp >= 0x200b && cp <= 0x200f && cp !== 0x200d) ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x2064) ||
    (cp >= 0x2066 && cp <= 0x2069) ||
    cp === 0xfeff ||
    cp === 0x00ad ||
    cp === 0x180e ||
    (cp >= 0xe0000 && cp <= 0xe007f)
  );
}

/** Make any repository-controlled string safe to print. */
function sanitizeDisplay(input) {
  const s = String(input == null ? '' : input);
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    out += isDangerousForDisplay(cp) ? describeCodePoint(cp) : ch;
  }
  if (out.length > MAX_DISPLAY_LENGTH) {
    out = `${out.slice(0, MAX_DISPLAY_LENGTH)}...[truncated]`;
  }
  return out;
}

/** GitHub workflow command message escaping. */
function escapeData(s) {
  return String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** GitHub workflow command property escaping. */
function escapeProperty(s) {
  return escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/**
 * An annotation with file= must bind to a path the runner can resolve. If the
 * path contains characters that would break that binding, the annotation is
 * emitted without file= and names the path inside the message instead, so no
 * annotation ever points at a path that does not exist.
 */
function isAnnotatablePath(p) {
  if (typeof p !== 'string' || p.length === 0) return false;
  if (p.length > 1024) return false;
  for (const ch of p) {
    const cp = ch.codePointAt(0);
    if (cp <= 0x1f || cp === 0x7f) return false;
  }
  return true;
}

function annotationCommand(severity) {
  if (severity === SEVERITY.ERROR) return 'error';
  if (severity === SEVERITY.WARNING) return 'warning';
  return 'notice';
}

/**
 * @param {object} finding
 * @returns {string} a single workflow command line
 */
function renderAnnotation(finding) {
  const command = annotationCommand(finding.severity);
  const title = `Skerry ${finding.rule} ${finding.name}`;
  const safePath = sanitizeDisplay(finding.path);
  const safeMessage = sanitizeDisplay(finding.message);

  const props = [`title=${escapeProperty(title)}`];
  let message;

  if (isAnnotatablePath(finding.file)) {
    props.push(`file=${escapeProperty(finding.file)}`, 'line=1', 'col=1');
    message = finding.path === finding.file
      ? safeMessage
      : `${safePath}: ${safeMessage}`;
  } else {
    const reason = finding.kind === 'ref' ? 'ref finding; no file annotation' : 'path cannot be annotated inline';
    message = `${safePath}: ${safeMessage} (${reason})`;
  }

  return `::${command} ${props.join(',')}::${escapeData(message)}`;
}

function renderAnnotations(findings) {
  return findings.map(renderAnnotation);
}

/** Plain text lines for the job log. */
function renderConsole(result) {
  const lines = [];
  for (const f of result.findings) {
    const sev = f.severity.toUpperCase().padEnd(7);
    lines.push(`${sev} ${f.rule}  ${sanitizeDisplay(f.path)}`);
    lines.push(`        ${sanitizeDisplay(f.message)}`);
  }
  return lines;
}

function escapeMarkdownCell(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/`/g, '\\`')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Markdown for $GITHUB_STEP_SUMMARY. */
function renderSummary(result, meta = {}) {
  const lines = [];
  lines.push('## Skerry');
  lines.push('');
  const verdict = result.counts.total === 0
    ? (meta.baseline && meta.baseline.configured ? 'No new hazards found.' : 'No path hazards found.')
    : `${result.counts.error} error(s), ${result.counts.warning} warning(s).`;
  lines.push(verdict);
  lines.push('');
  lines.push(`Scanned ${result.scanned} path(s) via the \`${meta.source || 'unknown'}\` source.`);
  if (result.ignored > 0) lines.push(`Ignored ${result.ignored} path(s) by pattern.`);
  if (meta.checkRefs) lines.push(`Scanned ${meta.refsScanned || 0} local branch/tag ref(s).`);
  if (meta.baseline && meta.baseline.configured) {
    lines.push(`Baseline suppressed ${meta.baseline.suppressed} finding(s); ${meta.baseline.stale} stale entr${meta.baseline.stale === 1 ? 'y' : 'ies'}.`);
  }
  lines.push('');

  if (result.findings.length > 0) {
    lines.push('| Severity | Rule | Path | Detail |');
    lines.push('| --- | --- | --- | --- |');
    const rows = result.findings.slice(0, MAX_SUMMARY_ROWS);
    for (const f of rows) {
      lines.push(
        `| ${f.severity} | ${f.rule} ${escapeMarkdownCell(f.name)} | ${escapeMarkdownCell(sanitizeDisplay(f.path))} | ${escapeMarkdownCell(sanitizeDisplay(f.message))} |`
      );
    }
    if (result.findings.length > rows.length) {
      lines.push('');
      lines.push(`_${result.findings.length - rows.length} further finding(s) not shown in this table._`);
    }
    lines.push('');
    const used = [...new Set(result.findings.map((f) => f.rule))].sort();
    lines.push('### Rules triggered');
    lines.push('');
    for (const id of used) {
      const rule = RULES[id];
      if (rule) lines.push(`- **${id} ${rule.name}** — ${rule.help}`);
    }
  }

  if (result.truncated) {
    lines.push('');
    lines.push(`_Output truncated: ${result.total} finding(s) in total._`);
  }
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  sanitizeDisplay,
  escapeData,
  escapeProperty,
  isAnnotatablePath,
  renderAnnotation,
  renderAnnotations,
  renderConsole,
  renderSummary,
  escapeMarkdownCell,
  MAX_DISPLAY_LENGTH,
  MAX_SUMMARY_ROWS,
};
