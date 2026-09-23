'use strict';

/**
 * Skerry — machine readable reports.
 *
 * Neither report contains a timestamp, a hostname, a run id or an absolute
 * path. Identical input therefore produces a byte-identical report, which is
 * what makes "deterministic" a checkable claim rather than a slogan.
 */

const { RULES, RULE_IDS, TOOL_NAME, VERSION, REPORT_SCHEMA } = require('./constants');

function buildJsonReport(result, meta = {}) {
  return {
    schema: REPORT_SCHEMA,
    tool: { name: TOOL_NAME, version: VERSION },
    source: meta.source || 'unknown',
    options: {
      maxPathLength: meta.maxPathLength,
      failOn: meta.failOn,
      disabled: [...(meta.disabled || [])].sort(),
      ignorePatterns: (meta.ignorePatterns || []).length,
      checkRefs: Boolean(meta.checkRefs),
    },
    scanned: result.scanned,
    ignored: result.ignored,
    counts: result.counts,
    truncated: result.truncated,
    refsScanned: meta.refsScanned || 0,
    baseline: meta.baseline || { configured: false, suppressed: 0, stale: 0 },
    findings: result.findings.map((f) => ({
      rule: f.rule,
      name: f.name,
      severity: f.severity,
      path: f.path,
      file: f.file,
      message: f.message,
      ...(f.kind ? { kind: f.kind } : {}),
      ...(f.refType ? { refType: f.refType } : {}),
      ...(f.related ? { related: f.related } : {}),
    })),
  };
}

function sarifLevel(severity) {
  if (severity === 'error') return 'error';
  if (severity === 'warning') return 'warning';
  return 'note';
}

function encodeUriPath(p) {
  return p
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

function buildSarifReport(result) {
  const rules = RULE_IDS.map((id) => ({
    id,
    name: RULES[id].name,
    shortDescription: { text: RULES[id].summary },
    fullDescription: { text: RULES[id].help },
    defaultConfiguration: { level: sarifLevel(RULES[id].severity) },
    properties: { tags: ['portability', 'filesystem'] },
  }));

  const results = result.findings.map((f) => {
    const item = {
      ruleId: f.rule,
      level: sarifLevel(f.severity),
      message: { text: f.message },
      properties: { kind: f.kind || 'path' },
    };
    if (f.file) {
      item.locations = [{ physicalLocation: {
        artifactLocation: { uri: encodeUriPath(f.file), uriBaseId: '%SRCROOT%' },
        region: { startLine: 1, startColumn: 1 },
      } }];
    }
    return item;
  });

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: TOOL_NAME,
            version: VERSION,
            informationUri: 'https://github.com/Dean00dev/skerry',
            rules,
          },
        },
        results,
      },
    ],
  };
}

module.exports = { buildJsonReport, buildSarifReport, encodeUriPath, sarifLevel };
