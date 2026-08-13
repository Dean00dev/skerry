'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { scan, DEFAULT_MAX_FINDINGS } = require('../src/scan');
const { compileAll } = require('../src/match');

test('disable switches a single rule off and leaves the rest', () => {
  const paths = ['a.txt', 'A.txt', 'nul'];
  const all = scan(paths);
  assert.ok(all.findings.some((f) => f.rule === 'SK001'));
  assert.ok(all.findings.some((f) => f.rule === 'SK004'));

  const partial = scan(paths, { disable: ['SK001'] });
  assert.ok(!partial.findings.some((f) => f.rule === 'SK001'));
  assert.ok(partial.findings.some((f) => f.rule === 'SK004'));
});

test('disabling SK001 still leaves SK010 able to fire', () => {
  const r = scan(
    [
      { path: 'docs/Link', mode: '120000' },
      { path: 'docs/link', mode: '100644' },
    ],
    { disable: ['SK001'] }
  );
  assert.deepEqual([...new Set(r.findings.map((f) => f.rule))], ['SK010']);
});

test('ignore patterns remove paths before any rule runs', () => {
  const paths = ['vendor/a.txt', 'vendor/A.txt', 'src/ok.js'];
  const r = scan(paths, { ignore: compileAll(['vendor/']) });
  assert.deepEqual(r.findings, []);
  assert.equal(r.ignored, 2);
  assert.equal(r.scanned, 1);
});

test('ignoring one side of a collision removes the collision entirely', () => {
  const r = scan(['a.txt', 'A.txt'], { ignore: compileAll(['A.txt']) });
  assert.deepEqual(r.findings, []);
});

test('findings are truncated but counts and totals are not', () => {
  const paths = Array.from({ length: 60 }, (_, i) => `dir/nul${i > 0 ? '' : ''}.${i}`);
  const many = Array.from({ length: 60 }, (_, i) => `d${i}/NUL.txt`);
  const r = scan(many, { maxFindings: 10 });
  assert.equal(r.findings.length, 10);
  assert.equal(r.counts.error, 60);
  assert.equal(r.total, 60);
  assert.equal(r.truncated, true);
  assert.ok(paths.length === 60);
});

test('default finding cap is applied when none is given', () => {
  const many = Array.from({ length: DEFAULT_MAX_FINDINGS + 5 }, (_, i) => `d${i}/NUL.txt`);
  const r = scan(many);
  assert.equal(r.findings.length, DEFAULT_MAX_FINDINGS);
  assert.equal(r.truncated, true);
});

test('output is deterministic regardless of input order', () => {
  const paths = ['z/A.txt', 'a/nul', 'z/a.txt', 'm/report:1.csv', 'q/ trailing '];
  const first = scan(paths);
  const second = scan([...paths].reverse());
  assert.deepEqual(first.findings, second.findings);
  assert.deepEqual(first.counts, second.counts);
});

test('errors sort ahead of warnings', () => {
  const r = scan(['zzz/nul', 'aaa/ leading.txt']);
  assert.equal(r.findings[0].severity, 'error');
  assert.equal(r.findings[r.findings.length - 1].severity, 'warning');
});

test('empty input is handled', () => {
  const r = scan([]);
  assert.deepEqual(r.findings, []);
  assert.equal(r.scanned, 0);
  assert.equal(r.counts.total, 0);
});

test('malformed entries are skipped rather than throwing', () => {
  const r = scan([null, undefined, '', { }, { path: 42 }, 'ok.txt', { path: 'a\u0000b' }]);
  assert.equal(r.scanned, 1);
  assert.deepEqual(r.findings, []);
});

test('leading ./ and / are stripped consistently', () => {
  const r = scan(['./src/a.txt', '/src/A.txt']);
  assert.equal(r.scanned, 2);
  assert.equal(r.findings.filter((f) => f.rule === 'SK001').length, 2);
  assert.ok(r.findings.every((f) => !f.path.startsWith('/')));
});

test('every finding carries a file that exists in the scanned set', () => {
  const paths = ['src/Utils/deep/a.js', 'src/utils/b.js', 'nul/x.txt'];
  const r = scan(paths);
  assert.ok(r.findings.length > 0);
  for (const f of r.findings) {
    assert.ok(paths.includes(f.file), `${f.file} should be a real scanned path`);
  }
});

test('a single path can produce findings from several rule families', () => {
  // 'nul' directory -> SK004, colon -> SK005, trailing space -> SK006,
  // right-to-left override -> SK009.
  const r = scan(['nul/a:b\u202E.txt ']);
  const found = new Set(r.findings.map((f) => f.rule));
  assert.ok(found.has('SK004'), 'reserved directory name');
  assert.ok(found.has('SK005'), 'illegal character');
  assert.ok(found.has('SK006'), 'trailing space');
  assert.ok(found.has('SK009'), 'bidi override');
});

test('the reserved name check reads the base before the first dot', () => {
  // Matches established prior art: NUL.txt is reserved, NUL:x.txt is an
  // illegal-character problem instead, and nullable.ts is neither.
  const reserved = scan(['NUL.txt']).findings.filter((f) => f.rule === 'SK004');
  const colon = scan(['NUL:x.txt']).findings.filter((f) => f.rule === 'SK004');
  assert.equal(reserved.length, 1);
  assert.equal(colon.length, 0);
  assert.ok(scan(['NUL:x.txt']).findings.some((f) => f.rule === 'SK005'));
});
