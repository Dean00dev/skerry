'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { scan } = require('../src/scan');
const baseline = require('../src/baseline');
const { scanRefs, inspectRefName, collectRefs } = require('../src/refs');
const { buildSarifReport } = require('../src/report');
const { renderAnnotation } = require('../src/render');
const { resolveInputs, InputError } = require('../src/inputs');

function temp(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skerry-v11-'));
  return path.join(dir, name);
}

test('baseline serialization is deterministic and round trips', () => {
  const result = scan(['src/a.txt', 'src/A.txt', 'nul']);
  const file = temp('baseline.json');
  const first = baseline.serialise(result.findings);
  assert.equal(first, baseline.serialise([...result.findings].reverse()));
  baseline.write(file, result.findings);
  assert.deepEqual([...baseline.load(file)], JSON.parse(first).entries);
  assert.ok(!first.includes('timestamp'));
});

test('a baseline suppresses only exact rule and path identities', () => {
  const before = scan(['src/a.txt', 'src/A.txt']);
  const after = scan(['src/a.txt', 'src/A.txt', 'CON.md']);
  const applied = baseline.apply(after, new Set(before.findings.map(baseline.keyFor)));
  assert.equal(applied.baselined, 2);
  assert.equal(applied.counts.error, 1);
  assert.equal(applied.findings[0].rule, 'SK004');
});

test('fixed baseline entries are exposed as stale', () => {
  const before = scan(['a', 'A', 'nul']);
  const after = scan(['a', 'b', 'nul']);
  const applied = baseline.apply(after, new Set(before.findings.map(baseline.keyFor)));
  assert.equal(applied.baselined, 1);
  assert.equal(applied.stale.length, 2);
});

test('baseline validation fails closed on malformed shape, count, duplicates, and entries', () => {
  for (const value of [
    'not json',
    JSON.stringify({ schema: 'wrong', count: 0, entries: [] }),
    JSON.stringify({ schema: baseline.BASELINE_SCHEMA, count: 2, entries: ['SK004 nul'] }),
    JSON.stringify({ schema: baseline.BASELINE_SCHEMA, count: 2, entries: ['SK004 nul', 'SK004 nul'] }),
    JSON.stringify({ schema: baseline.BASELINE_SCHEMA, count: 1, entries: ['SK999 x'] }),
    JSON.stringify({ schema: baseline.BASELINE_SCHEMA, count: 1, entries: ['SK004 x\ny'] }),
  ]) {
    const file = temp('bad.json');
    fs.writeFileSync(file, value);
    assert.throws(() => baseline.load(file), baseline.BaselineError);
  }
});

test('baseline and write-baseline are mutually exclusive', () => {
  assert.throws(() => resolveInputs({}, ['--baseline', 'a.json', '--write-baseline', 'b.json']), InputError);
});

test('check-refs defaults off and accepts explicit true', () => {
  assert.equal(resolveInputs({}, []).checkRefs, false);
  assert.equal(resolveInputs({}, ['--check-refs']).checkRefs, true);
});

test('SK012 catches reserved device components but does not invent COM0 or LPT0', () => {
  const hits = scanRefs(['feature/aux', 'hotfix/nul', 'feature/COM0', 'feature/LPT0']).findings;
  assert.deepEqual(hits.filter((f) => f.rule === 'SK012').map((f) => f.path), ['ref:feature/aux', 'ref:hotfix/nul']);
});

test('SK012 catches the four characters Git permits and Windows rejects', () => {
  for (const ch of ['<', '>', '"', '|']) assert.equal(scanRefs([`a${ch}b`]).findings[0].rule, 'SK012');
});

test('ordinary branch and tag names are clean', () => {
  assert.deepEqual(scanRefs(['main', 'feature/add-login', 'release/v1.2.3']).findings, []);
  assert.deepEqual(inspectRefName('dependabot/npm/lodash-4.17.21'), []);
});

test('SK013 detects case and normalization collisions within one namespace', () => {
  const result = scanRefs(['refs/heads/Feature/Login', 'refs/heads/feature/login']);
  assert.equal(result.findings.filter((f) => f.rule === 'SK013').length, 2);
});

test('same branch and tag spelling is not a cross-namespace collision', () => {
  const result = scanRefs(['refs/heads/release', 'refs/tags/release']);
  assert.deepEqual(result.findings, []);
});

test('ref findings cannot forge file annotations or SARIF file locations', () => {
  const finding = scanRefs(['feature/aux']).findings[0];
  assert.ok(!renderAnnotation(finding).includes(',file='));
  const sarif = buildSarifReport({ findings: [finding] });
  assert.equal(sarif.runs[0].results[0].locations, undefined);
  assert.equal(sarif.runs[0].results[0].properties.kind, 'ref');
});

test('ref collection prefers the pull request head over the synthetic merge ref', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skerry-ref-env-'));
  assert.deepEqual(collectRefs(dir, { GITHUB_HEAD_REF: 'feature/aux', GITHUB_REF_NAME: '42/merge' }), ['refs/heads/feature/aux']);
});

test('ref collection preserves branch and tag namespaces from git', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skerry-ref-git-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Skerry Test'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'skerry@example.invalid'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'x'), 'x');
  execFileSync('git', ['add', 'x'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'x'], { cwd: dir });
  execFileSync('git', ['branch', 'release'], { cwd: dir });
  execFileSync('git', ['tag', 'release'], { cwd: dir });
  const refs = collectRefs(dir, {});
  assert.ok(refs.includes('refs/heads/release'));
  assert.ok(refs.includes('refs/tags/release'));
  assert.deepEqual(scanRefs(refs).findings, []);
});

test('ref findings are deterministic and rules disable independently', () => {
  const refs = ['feature/aux', 'Feature/X', 'feature/x'];
  assert.deepEqual(scanRefs(refs).findings, scanRefs([...refs].reverse()).findings);
  assert.ok(!scanRefs(refs, { disable: ['SK012'] }).findings.some((f) => f.rule === 'SK012'));
  assert.ok(!scanRefs(refs, { disable: ['SK013'] }).findings.some((f) => f.rule === 'SK013'));
});
