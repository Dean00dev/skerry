'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ENTRY = path.join(__dirname, '..', 'src', 'index.js');
function dir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'skerry-v11-e2e-')); }
function manifest(root, lines) { const file = path.join(root, 'paths.txt'); fs.writeFileSync(file, lines); return file; }
function run(root, args, extraEnv = {}) {
  const output = path.join(root, `out-${Math.random().toString(16).slice(2)}.txt`);
  fs.writeFileSync(output, '');
  const proc = spawnSync(process.execPath, [ENTRY, ...args], {
    cwd: root,
    env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, ...extraEnv },
    encoding: 'utf8',
  });
  return { status: proc.status, stdout: proc.stdout, outputs: fs.readFileSync(output, 'utf8') };
}

test('write-baseline then baseline permits old findings and rejects a new one', () => {
  const root = dir();
  const list = manifest(root, 'a\nA\n');
  const baseline = path.join(root, 'baseline.json');
  const written = run(root, ['--source', 'list', '--paths-file', list, '--write-baseline', baseline]);
  assert.equal(written.status, 0);
  assert.equal(JSON.parse(fs.readFileSync(baseline, 'utf8')).count, 2);

  const old = run(root, ['--source', 'list', '--paths-file', list, '--baseline', baseline]);
  assert.equal(old.status, 0);
  assert.ok(old.stdout.includes('no new hazards found'));
  assert.ok(old.outputs.includes('baselined<<'));
  assert.ok(old.outputs.includes('\n2\n'));

  fs.writeFileSync(list, 'a\nA\nnul\n');
  const changed = run(root, ['--source', 'list', '--paths-file', list, '--baseline', baseline]);
  assert.equal(changed.status, 1);
  assert.ok(changed.stdout.includes('SK004'));
});

test('baseline operations reject truncated finding identities', () => {
  const root = dir();
  const list = manifest(root, 'a\nA\nnul\n');
  const result = run(root, ['--source', 'list', '--paths-file', list, '--max-findings', '1', '--write-baseline', 'b.json']);
  assert.equal(result.status, 2);
  assert.ok(result.stdout.includes('complete finding set'));
  assert.equal(fs.existsSync(path.join(root, 'b.json')), false);
});

test('baseline notices respect annotations false', () => {
  const root = dir();
  const list = manifest(root, 'nul\n');
  const baseline = path.join(root, 'baseline.json');
  assert.equal(run(root, ['--source', 'list', '--paths-file', list, '--write-baseline', baseline, '--annotations', 'false']).status, 0);
  const result = run(root, ['--source', 'list', '--paths-file', list, '--baseline', baseline, '--annotations', 'false']);
  assert.equal(result.status, 0);
  assert.ok(!result.stdout.includes('::notice'));
  assert.ok(result.stdout.includes('NOTICE  Skerry'));
});

test('opt-in pull request head checking reports refs separately from paths', () => {
  const root = dir();
  fs.writeFileSync(path.join(root, 'safe.txt'), 'x');
  const result = run(root, ['--source', 'fs', '--check-refs'], { GITHUB_HEAD_REF: 'feature/aux', GITHUB_REF_NAME: '42/merge' });
  assert.equal(result.status, 1);
  assert.ok(result.stdout.includes('SK012'));
  assert.ok(result.stdout.includes('branch:feature/aux'));
  assert.ok(result.outputs.includes('refs-scanned<<'));
});

test('JSON receipts expose aggregate baseline state without suppressed findings', () => {
  const root = dir();
  const list = manifest(root, 'nul\n');
  const baseline = path.join(root, 'baseline.json');
  run(root, ['--source', 'list', '--paths-file', list, '--write-baseline', baseline]);
  const report = path.join(root, 'report.json');
  const result = run(root, ['--source', 'list', '--paths-file', list, '--baseline', baseline, '--report-json', report]);
  assert.equal(result.status, 0);
  const receipt = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.deepEqual(receipt.baseline, { configured: true, suppressed: 1, stale: 0 });
  assert.deepEqual(receipt.findings, []);
});
