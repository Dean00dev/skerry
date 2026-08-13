'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildJsonReport, buildSarifReport, encodeUriPath, sarifLevel } = require('../src/report');
const { scan } = require('../src/scan');
const { RULE_IDS } = require('../src/constants');

const SAMPLE = ['src/a.txt', 'src/A.txt', 'nul', 'long/ leading.md'];

test('the JSON report carries the schema, tool and counts', () => {
  const result = scan(SAMPLE);
  const report = buildJsonReport(result, { source: 'git', failOn: 'error', maxPathLength: 200 });
  assert.equal(report.schema, 'skerry-report/1');
  assert.equal(report.tool.name, 'Skerry');
  assert.equal(report.source, 'git');
  assert.equal(report.counts.total, result.counts.total);
  assert.equal(report.findings.length, result.findings.length);
});

test('the JSON report contains no timestamp, hostname or absolute path', () => {
  const report = buildJsonReport(scan(SAMPLE), { source: 'git' });
  const text = JSON.stringify(report);
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(text), 'no ISO timestamp');
  assert.ok(!text.includes(process.cwd()), 'no absolute path');
  assert.ok(!/"(time|timestamp|date|host|runId)"/.test(text));
});

test('the same input produces a byte-identical JSON report', () => {
  const meta = { source: 'git', failOn: 'error', maxPathLength: 200, disabled: [], ignorePatterns: [] };
  const a = JSON.stringify(buildJsonReport(scan(SAMPLE), meta));
  const b = JSON.stringify(buildJsonReport(scan([...SAMPLE].reverse()), meta));
  assert.equal(a, b);
});

test('the JSON report records how many ignore patterns ran, not their content', () => {
  const report = buildJsonReport(scan(SAMPLE), {
    source: 'git',
    ignorePatterns: ['secret-project/**', 'internal/*'],
  });
  const text = JSON.stringify(report);
  assert.equal(report.options.ignorePatterns, 2);
  assert.ok(!text.includes('secret-project'));
});

test('SARIF output declares every rule in the catalogue', () => {
  const sarif = buildSarifReport(scan(SAMPLE));
  const declared = sarif.runs[0].tool.driver.rules.map((r) => r.id);
  assert.deepEqual(declared.sort(), [...RULE_IDS].sort());
});

test('SARIF results reference a declared rule and a location', () => {
  const sarif = buildSarifReport(scan(SAMPLE));
  const declared = new Set(sarif.runs[0].tool.driver.rules.map((r) => r.id));
  assert.ok(sarif.runs[0].results.length > 0);
  for (const r of sarif.runs[0].results) {
    assert.ok(declared.has(r.ruleId));
    assert.ok(r.locations[0].physicalLocation.artifactLocation.uri.length > 0);
    assert.ok(['error', 'warning', 'note'].includes(r.level));
  }
});

test('SARIF version and schema are the expected ones', () => {
  const sarif = buildSarifReport(scan(SAMPLE));
  assert.equal(sarif.version, '2.1.0');
  assert.ok(sarif.$schema.includes('sarif-2.1.0'));
});

test('SARIF uris are percent encoded per segment, keeping separators', () => {
  assert.equal(encodeUriPath('a b/c.txt'), 'a%20b/c.txt');
  assert.equal(encodeUriPath('dir/#hash?.md'), 'dir/%23hash%3F.md');
  assert.equal(encodeUriPath('plain/file.js'), 'plain/file.js');
});

test('severity maps to SARIF levels', () => {
  assert.equal(sarifLevel('error'), 'error');
  assert.equal(sarifLevel('warning'), 'warning');
  assert.equal(sarifLevel('notice'), 'note');
});

test('an empty scan still produces valid, serialisable reports', () => {
  const result = scan(['clean.txt']);
  const json = buildJsonReport(result, { source: 'git' });
  const sarif = buildSarifReport(result);
  assert.deepEqual(json.findings, []);
  assert.deepEqual(sarif.runs[0].results, []);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(sarif)));
});

test('reports survive hostile filenames without breaking JSON', () => {
  const result = scan(['evil/a"b\\c:d.txt', 'evil/\u202Ex.txt']);
  const round = JSON.parse(JSON.stringify(buildJsonReport(result, { source: 'list' })));
  assert.equal(round.findings.length, result.findings.length);
  const sarifRound = JSON.parse(JSON.stringify(buildSarifReport(result)));
  assert.equal(sarifRound.runs[0].results.length, result.findings.length);
});
