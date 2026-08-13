'use strict';

/**
 * End to end: the real entrypoint is spawned as a child process with the same
 * environment variables the GitHub Actions runner sets, and the files it is
 * supposed to write are read back from disk.
 *
 * This simulates the runner. It is NOT a live GitHub round trip: nothing here
 * proves how github.com renders an annotation. See VERIFICATION.md.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const ENTRY = path.join(__dirname, '..', 'src', 'index.js');
const REPO = path.join(__dirname, '..');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `skerry-e2e-${prefix}-`));
}

/** Run the action the way a runner would: env inputs, no shell. */
function runAction(inputs = {}, opts = {}) {
  const dir = opts.workspace || tempDir('run');
  const outputFile = path.join(tempDir('out'), 'outputs.txt');
  const summaryFile = path.join(tempDir('sum'), 'summary.md');
  fs.writeFileSync(outputFile, '');
  fs.writeFileSync(summaryFile, '');

  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GITHUB_OUTPUT: outputFile,
    GITHUB_STEP_SUMMARY: summaryFile,
    GITHUB_ACTIONS: 'true',
    RUNNER_OS: 'Linux',
  };
  for (const [key, value] of Object.entries(inputs)) {
    env[`INPUT_${key.toUpperCase()}`] = String(value);
  }

  const proc = spawnSync(process.execPath, [ENTRY], {
    cwd: dir,
    env,
    encoding: 'utf8',
    timeout: 60000,
  });

  return {
    status: proc.status,
    stdout: proc.stdout || '',
    stderr: proc.stderr || '',
    outputs: parseOutputs(fs.readFileSync(outputFile, 'utf8')),
    summary: fs.readFileSync(summaryFile, 'utf8'),
    dir,
  };
}

/** Parse the heredoc form the action writes to $GITHUB_OUTPUT. */
function parseOutputs(text) {
  const out = {};
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^([A-Za-z0-9_-]+)<<(skerry_[0-9a-f]{32})$/.exec(lines[i]);
    if (!match) continue;
    const [, key, delimiter] = match;
    const value = [];
    i += 1;
    while (i < lines.length && lines[i] !== delimiter) {
      value.push(lines[i]);
      i += 1;
    }
    out[key] = value.join('\n');
  }
  return out;
}

function writeManifest(contents) {
  const dir = tempDir('manifest');
  const file = path.join(dir, 'paths.txt');
  fs.writeFileSync(file, contents);
  return file;
}

function gitInstalled() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('a clean workspace exits 0 and reports success', () => {
  const dir = tempDir('clean');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), 'x');
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'x');

  const r = runAction({}, { workspace: dir });
  assert.equal(r.status, 0);
  assert.equal(r.outputs.passed, 'true');
  assert.equal(r.outputs.errors, '0');
  assert.equal(r.outputs.findings, '0');
  assert.equal(r.outputs.source, 'fs');
  assert.ok(r.stdout.includes('no hazards found'));
  assert.ok(r.summary.includes('No path hazards found.'));
});

test('a hazardous manifest exits 1 and emits annotations', () => {
  const file = writeManifest('src/a.txt\nsrc/A.txt\nnul\n');
  const r = runAction({ source: 'list', 'paths-file': file });
  assert.equal(r.status, 1);
  assert.equal(r.outputs.passed, 'false');
  assert.equal(r.outputs.errors, '3');
  assert.ok(r.stdout.includes('::error title=Skerry SK001'));
  assert.ok(r.stdout.includes('::error title=Skerry SK004'));
});

test('every emitted annotation is a single well formed line', () => {
  const file = writeManifest('a.txt\nA.txt\nnul\n docs/x.md\nlong:name.md\n');
  const r = runAction({ source: 'list', 'paths-file': file });
  const annotations = r.stdout.split('\n').filter((l) => l.startsWith('::'));
  assert.ok(annotations.length >= 4);
  for (const line of annotations) {
    assert.match(line, /^::(error|warning|notice) [^:]*::/);
  }
});

test('fail-on warning turns a warning into a failure', () => {
  const file = writeManifest('data/ leading.csv\n');
  const strict = runAction({ source: 'list', 'paths-file': file, 'fail-on': 'warning' });
  const lenient = runAction({ source: 'list', 'paths-file': file, 'fail-on': 'error' });
  assert.equal(strict.status, 1);
  assert.equal(lenient.status, 0);
  assert.equal(lenient.outputs.warnings, '1');
});

test('fail-on never always exits 0 but still reports the counts', () => {
  const file = writeManifest('src/a.txt\nsrc/A.txt\nnul\n');
  const r = runAction({ source: 'list', 'paths-file': file, 'fail-on': 'never' });
  assert.equal(r.status, 0);
  assert.equal(r.outputs.passed, 'true');
  assert.equal(r.outputs.errors, '3');
});

test('truncation never hides a failure', () => {
  const many = Array.from({ length: 30 }, (_, i) => `d${i}/NUL.txt`).join('\n');
  const r = runAction({ source: 'list', 'paths-file': writeManifest(many), 'max-findings': '5' });
  assert.equal(r.status, 1);
  assert.equal(r.outputs.errors, '30');
  assert.ok(r.stdout.includes('Output truncated'));
});

test('an invalid input exits 2 with an understandable message', () => {
  const r = runAction({ 'fail-on': 'catastrophic' });
  assert.equal(r.status, 2);
  assert.ok(r.stdout.includes('::error title=Skerry::'));
  assert.ok(r.stdout.includes('fail-on'));
  assert.equal(Object.keys(r.outputs).length, 0, 'no outputs are written on a usage error');
});

test('an unreadable path exits 2 rather than crashing', () => {
  const r = runAction({ path: 'no/such/directory', source: 'fs' });
  assert.equal(r.status, 2);
  assert.ok(r.stdout.includes('::error'));
});

test('requesting git outside a work tree exits 2', () => {
  const r = runAction({ source: 'git' });
  assert.equal(r.status, 2);
  assert.ok(r.stdout.toLowerCase().includes('git'));
});

test('JSON and SARIF reports are written where asked', () => {
  const dir = tempDir('reports');
  const file = writeManifest('src/a.txt\nsrc/A.txt\n');
  const r = runAction(
    {
      source: 'list',
      'paths-file': file,
      'report-json': 'out/report.json',
      'report-sarif': 'out/report.sarif',
    },
    { workspace: dir }
  );
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'report.json'), 'utf8'));
  const sarif = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'report.sarif'), 'utf8'));
  assert.equal(json.counts.error, 2);
  assert.equal(sarif.version, '2.1.0');
  assert.equal(
    fs.realpathSync(r.outputs['report-json-path']),
    fs.realpathSync(path.join(dir, 'out', 'report.json'))
  );
});

test('two identical runs produce byte identical JSON reports', () => {
  const file = writeManifest('src/a.txt\nsrc/A.txt\nnul\n');
  const read = () => {
    const dir = tempDir('determinism');
    runAction({ source: 'list', 'paths-file': file, 'report-json': 'r.json' }, { workspace: dir });
    return fs.readFileSync(path.join(dir, 'r.json'), 'utf8');
  };
  assert.equal(read(), read());
});

test('ignore patterns are honoured end to end', () => {
  const file = writeManifest('vendor/a.txt\nvendor/A.txt\nsrc/ok.js\n');
  const r = runAction({ source: 'list', 'paths-file': file, ignore: 'vendor/' });
  assert.equal(r.status, 0);
  assert.equal(r.outputs.ignored, '2');
  assert.equal(r.outputs.scanned, '1');
});

test('annotations false switches to plain text output', () => {
  const file = writeManifest('nul\n');
  const r = runAction({ source: 'list', 'paths-file': file, annotations: 'false' });
  const lines = r.stdout.split('\n').filter((l) => l.startsWith('::error title=Skerry SK'));
  assert.equal(lines.length, 0);
  assert.ok(r.stdout.includes('ERROR   SK004'));
});

test('summary false leaves the job summary untouched', () => {
  const file = writeManifest('nul\n');
  const r = runAction({ source: 'list', 'paths-file': file, summary: 'false' });
  assert.equal(r.summary.trim(), '');
});

test('the log never prints an environment secret', () => {
  const file = writeManifest('nul\n');
  const r = runAction({ source: 'list', 'paths-file': file });
  assert.ok(!r.stdout.includes(process.env.PATH || '@@none@@'));
  assert.ok(!/GITHUB_OUTPUT|GITHUB_STEP_SUMMARY/.test(r.stdout));
});

test(
  'a real git repository with a portable hazardous file is caught',
  { skip: !gitInstalled() },
  () => {
    const dir = tempDir('realgit');
    const run = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    run(['init', '-q']);
    run(['config', 'user.email', 'test@example.invalid']);
    run(['config', 'user.name', 'Skerry Test']);

    // U+202E is representable on Linux, macOS and Windows, but can visually
    // reorder the suffix. Platform-illegal names are covered through source:list.
    const deceptive = 'invoice-\u202Etxt.js';
    fs.writeFileSync(path.join(dir, deceptive), 'x');
    fs.writeFileSync(path.join(dir, 'untracked-\u202Etxt.js'), 'x');
    run(['add', deceptive]);

    const r = runAction({ 'fail-on': 'warning' }, { workspace: dir });
    assert.equal(r.status, 1);
    assert.equal(r.outputs.source, 'git');
    assert.ok(r.stdout.includes('SK009'));
    assert.ok(
      !r.stdout.includes('untracked-'),
      'the git source must only see tracked paths'
    );
  }
);

test('Skerry finds nothing wrong with its own repository', { skip: !gitInstalled() }, () => {
  const r = runAction({ 'fail-on': 'warning' }, { workspace: REPO });
  assert.equal(r.status, 0, `Skerry must be clean by its own strictest rules:\n${r.stdout}`);
  assert.equal(r.outputs.findings, '0');
});
