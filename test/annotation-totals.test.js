'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const ENTRY = path.join(ROOT, 'src', 'index.js');

function writeManifest(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skerry-totals-'));
  const file = path.join(dir, 'paths.txt');
  fs.writeFileSync(file, contents);
  return file;
}

function runAction(inputs) {
  const outputFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'skerry-out-')),
    'outputs.txt'
  );
  fs.writeFileSync(outputFile, '');

  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GITHUB_OUTPUT: outputFile,
    GITHUB_ACTIONS: 'true',
  };
  for (const [key, value] of Object.entries(inputs)) {
    env[`INPUT_${key.toUpperCase()}`] = String(value);
  }

  const proc = spawnSync(process.execPath, [ENTRY], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: 60000,
  });

  const raw = fs.readFileSync(outputFile, 'utf8');
  const outputs = {};
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^([A-Za-z0-9_-]+)<<(skerry_[0-9a-f]{32})$/.exec(lines[i]);
    if (!match) continue;
    const value = [];
    i += 1;
    while (i < lines.length && lines[i] !== match[2]) {
      value.push(lines[i]);
      i += 1;
    }
    outputs[match[1]] = value.join('\n');
  }

  const stdout = proc.stdout || '';
  const count = (prefix) => stdout.split('\n').filter((line) => line.startsWith(prefix)).length;

  return {
    status: proc.status,
    stdout,
    outputs,
    errorLines: count('::error'),
    warningLines: count('::warning'),
  };
}

test('error annotation total equals the errors output', () => {
  const file = writeManifest('src/a.txt\nsrc/A.txt\nnul\n');
  const result = runAction({ source: 'list', 'paths-file': file, summary: 'false' });

  assert.equal(result.status, 1, 'the step must still fail');
  assert.equal(result.errorLines, Number(result.outputs.errors));
});

test('the failure explainer is a notice rather than a finding', () => {
  const file = writeManifest('src/a.txt\nsrc/A.txt\n');
  const result = runAction({ source: 'list', 'paths-file': file, summary: 'false' });

  assert.ok(result.stdout.includes('::notice title=Skerry::Path hazards found.'));
  assert.ok(!result.stdout.includes('::error title=Skerry::Path hazards found.'));
});

test('downgrading the explainer does not stop the step failing', () => {
  const file = writeManifest('nul\n');
  const result = runAction({ source: 'list', 'paths-file': file, summary: 'false' });

  assert.equal(result.status, 1);
  assert.equal(result.outputs.passed, 'false');
});

test('warning annotations reconcile under fail-on warning', () => {
  const file = writeManifest('data/ leading.csv\ndocs/zero\u200Bwidth.md\n');
  const result = runAction({
    source: 'list',
    'paths-file': file,
    'fail-on': 'warning',
    summary: 'false',
  });

  assert.equal(result.status, 1);
  assert.equal(result.outputs.errors, '0');
  assert.equal(result.errorLines, 0);
  assert.equal(result.warningLines, Number(result.outputs.warnings));
});

test('a clean run emits no annotations or failure explainer', () => {
  const file = writeManifest('src/index.js\nREADME.md\n');
  const result = runAction({ source: 'list', 'paths-file': file, summary: 'false' });

  assert.equal(result.status, 0);
  assert.equal(result.errorLines, 0);
  assert.equal(result.warningLines, 0);
  assert.ok(!result.stdout.includes('Path hazards found'));
});

test('the deliberately failing CI job suppresses annotations', () => {
  const workflow = fs.readFileSync(
    path.join(ROOT, '.github', 'workflows', 'ci.yml'),
    'utf8'
  );
  const start = workflow.indexOf('\n  self-catches:');
  assert.ok(start !== -1, 'the self-catches job should exist');

  const rest = workflow.slice(start + 1);
  const nextJob = rest.search(/\n {2}[a-z][a-z0-9-]*:\n/);
  const block = nextJob === -1 ? rest : rest.slice(0, nextJob);

  assert.ok(/^\s+annotations: false$/m.test(block));
  assert.ok(block.includes('continue-on-error: true'));
});
