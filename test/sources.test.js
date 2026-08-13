'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { collect, fromGit, fromFs, fromList, gitAvailable, SourceError } = require('../src/sources');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `skerry-${prefix}-`));
}

function gitInstalled() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('fromList reads a plain manifest', () => {
  const dir = tempDir('list');
  const file = path.join(dir, 'paths.txt');
  fs.writeFileSync(file, '# comment\n\nsrc/a.txt\r\ndocs/b.md\n');
  const { entries, source } = fromList(file);
  assert.equal(source, 'list');
  assert.deepEqual(entries.map((e) => e.path), ['src/a.txt', 'docs/b.md']);
});

test('fromList reads the optional mode prefix', () => {
  const dir = tempDir('list-mode');
  const file = path.join(dir, 'paths.txt');
  fs.writeFileSync(file, '120000\tdocs/Link\n100644\tdocs/link\n');
  const { entries } = fromList(file);
  assert.deepEqual(entries, [
    { path: 'docs/Link', mode: '120000' },
    { path: 'docs/link', mode: '100644' },
  ]);
});

test('fromList reports a missing file as a source error', () => {
  assert.throws(() => fromList(path.join(tempDir('missing'), 'nope.txt')), SourceError);
});

test('fromList fails closed instead of truncating an oversized manifest', () => {
  const dir = tempDir('list-limit');
  const file = path.join(dir, 'paths.txt');
  fs.writeFileSync(file, 'one\ntwo\nthree\n');
  assert.throws(() => fromList(file, 2), /incomplete scan/);
});

test('fromList rejects an oversized manifest before reading it', () => {
  const dir = tempDir('list-bytes');
  const file = path.join(dir, 'paths.txt');
  fs.writeFileSync(file, '12345');
  assert.throws(() => fromList(file, 100, 100, 4), /safety limit/);
});

test('fromList applies the depth cap to synthetic paths', () => {
  const dir = tempDir('list-depth');
  const file = path.join(dir, 'paths.txt');
  fs.writeFileSync(file, 'one/two/three/file.txt\n');
  assert.throws(() => fromList(file, 100, 2), /incomplete scan/);
});

test('fromFs walks a directory tree and returns relative paths', () => {
  const dir = tempDir('walk');
  fs.mkdirSync(path.join(dir, 'src', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), 'x');
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'x');
  fs.writeFileSync(path.join(dir, 'src', 'lib', 'deep.js'), 'x');

  const { entries } = fromFs(dir);
  assert.deepEqual(
    entries.map((e) => e.path).sort(),
    ['README.md', 'src/index.js', 'src/lib/deep.js']
  );
});

test('fromFs skips a top level .git directory', () => {
  const dir = tempDir('walk-git');
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main');
  fs.writeFileSync(path.join(dir, 'file.txt'), 'x');
  const { entries } = fromFs(dir);
  assert.deepEqual(entries.map((e) => e.path), ['file.txt']);
});

test('fromFs records symlinks without following them', () => {
  const dir = tempDir('walk-link');
  fs.mkdirSync(path.join(dir, 'real'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'real', 'file.txt'), 'x');
  fs.symlinkSync(path.join(dir, 'real'), path.join(dir, 'alias'), 'dir');

  const { entries } = fromFs(dir);
  const alias = entries.find((e) => e.path === 'alias');
  assert.ok(alias, 'the symlink itself is recorded');
  assert.equal(alias.mode, '120000');
  assert.ok(!entries.some((e) => e.path.startsWith('alias/')), 'the link must not be traversed');
});

test('a symlink loop cannot cause runaway traversal', () => {
  const dir = tempDir('loop');
  fs.mkdirSync(path.join(dir, 'a'), { recursive: true });
  fs.symlinkSync(dir, path.join(dir, 'a', 'back'), 'dir');
  const { entries } = fromFs(dir);
  assert.ok(entries.length < 10, 'traversal terminates immediately');
});

test('fromFs fails closed at the entry limit', () => {
  const dir = tempDir('walk-limit');
  fs.writeFileSync(path.join(dir, 'one'), 'x');
  fs.writeFileSync(path.join(dir, 'two'), 'x');
  fs.writeFileSync(path.join(dir, 'three'), 'x');
  assert.throws(() => fromFs(dir, 2), /incomplete scan/);
});

test('fromFs fails closed at the directory-depth limit', () => {
  const dir = tempDir('walk-depth');
  fs.mkdirSync(path.join(dir, 'one', 'two', 'three'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'one', 'two', 'three', 'file.txt'), 'x');
  assert.throws(() => fromFs(dir, 100, 2), /incomplete scan/);
});

test('collect rejects a path that is not a directory', () => {
  const dir = tempDir('notdir');
  const file = path.join(dir, 'a.txt');
  fs.writeFileSync(file, 'x');
  assert.throws(() => collect({ source: 'fs', dir: file }), SourceError);
});

test('collect rejects a path that does not exist', () => {
  assert.throws(() => collect({ source: 'fs', dir: '/definitely/not/here/at/all' }), SourceError);
});

test('collect with source list requires paths-file', () => {
  assert.throws(() => collect({ source: 'list' }), SourceError);
});

test('auto falls back to a filesystem walk outside a git work tree', () => {
  const dir = tempDir('auto');
  fs.writeFileSync(path.join(dir, 'file.txt'), 'x');
  const result = collect({ source: 'auto', dir });
  assert.equal(result.source, 'fs');
  assert.equal(result.fellBack, true);
});

test('source git refuses to run outside a git work tree', () => {
  const dir = tempDir('nogit');
  fs.writeFileSync(path.join(dir, 'file.txt'), 'x');
  assert.throws(() => collect({ source: 'git', dir }), SourceError);
});

test('git source reads the index including file modes', { skip: !gitInstalled() }, () => {
  const dir = tempDir('gitrepo');
  const run = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  run(['init', '-q']);
  run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'user.name', 'Skerry Test']);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'x');
  fs.writeFileSync(path.join(dir, 'untracked.txt'), 'x');
  fs.symlinkSync('src/index.js', path.join(dir, 'alias.js'));
  run(['add', 'src/index.js', 'alias.js']);

  const result = collect({ source: 'git', dir });
  assert.equal(result.source, 'git');
  const paths = result.entries.map((e) => e.path).sort();
  assert.deepEqual(paths, ['alias.js', 'src/index.js']);
  assert.ok(!paths.includes('untracked.txt'), 'untracked files are not in the index');
  assert.equal(result.entries.find((e) => e.path === 'alias.js').mode, '120000');
});

test('auto does not hide a git collection failure with a filesystem fallback', { skip: !gitInstalled() }, () => {
  const dir = tempDir('git-corrupt');
  const run = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  run(['init', '-q']);
  fs.writeFileSync(path.join(dir, 'file.txt'), 'x');
  run(['add', 'file.txt']);
  fs.writeFileSync(path.join(dir, '.git', 'index'), 'not a git index');
  assert.equal(gitAvailable(dir), true);
  assert.throws(() => collect({ source: 'auto', dir }), SourceError);
});

test('fromGit fails closed at the entry limit', { skip: !gitInstalled() }, () => {
  const dir = tempDir('git-limit');
  const run = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  run(['init', '-q']);
  for (const name of ['one', 'two', 'three']) fs.writeFileSync(path.join(dir, name), 'x');
  run(['add', '.']);
  assert.throws(() => fromGit(dir, 2), /incomplete scan/);
});

test('fromGit applies the depth cap to indexed paths', { skip: !gitInstalled() }, () => {
  const dir = tempDir('git-depth');
  const run = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  run(['init', '-q']);
  fs.mkdirSync(path.join(dir, 'one', 'two'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'one', 'two', 'file.txt'), 'x');
  run(['add', '.']);
  assert.throws(() => fromGit(dir, 100, 1), /incomplete scan/);
});

test('git source handles a directory name that looks like an option', { skip: !gitInstalled() }, () => {
  const parent = tempDir('dashdir');
  const dir = path.join(parent, '--upload-pack=touch');
  fs.mkdirSync(dir, { recursive: true });
  const run = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  run(['init', '-q']);
  run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'user.name', 'Skerry Test']);
  fs.writeFileSync(path.join(dir, 'file.txt'), 'x');
  run(['add', 'file.txt']);

  const result = collect({ source: 'git', dir });
  assert.deepEqual(result.entries.map((e) => e.path), ['file.txt']);
});

test('gitAvailable is false for a plain directory', () => {
  const dir = tempDir('plain');
  assert.equal(gitAvailable(dir), false);
});
