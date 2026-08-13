'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { scan, classifyCollision, codePointSpelling } = require('../src/scan');

function rules(result) {
  return [...new Set(result.findings.map((f) => f.rule))].sort();
}

function findingsFor(result, rule) {
  return result.findings.filter((f) => f.rule === rule);
}

test('SK001 detects a file level case collision', () => {
  const r = scan(['src/a.txt', 'src/A.txt']);
  assert.deepEqual(rules(r), ['SK001']);
  assert.equal(findingsFor(r, 'SK001').length, 2, 'both sides are reported');
  assert.equal(r.counts.error, 2);
});

test('SK001 detects a directory level case collision once, not once per file', () => {
  const r = scan([
    'src/Utils/a.js',
    'src/Utils/b.js',
    'src/utils/c.js',
    'src/utils/d.js',
  ]);
  assert.deepEqual(rules(r), ['SK001']);
  assert.equal(findingsFor(r, 'SK001').length, 2);
  assert.deepEqual(
    findingsFor(r, 'SK001').map((f) => f.path).sort(),
    ['src/Utils', 'src/utils']
  );
});

test('SK001 detects a file colliding with a directory', () => {
  const r = scan(['config', 'Config/settings.yml']);
  assert.deepEqual(rules(r), ['SK001']);
  assert.equal(findingsFor(r, 'SK001').length, 2);
});

test('collisions in different directories do not cross-contaminate', () => {
  const r = scan(['one/readme.md', 'two/README.md']);
  assert.deepEqual(r.findings, []);
});

test('SK002 detects an NFC versus NFD collision', () => {
  const r = scan(['docs/caf\u00E9.md', 'docs/cafe\u0301.md']);
  assert.ok(rules(r).includes('SK002'));
  assert.equal(findingsFor(r, 'SK002').length, 2);
});

test('SK002 message spells out the differing code points', () => {
  const r = scan(['docs/caf\u00E9.md', 'docs/cafe\u0301.md']);
  const message = findingsFor(r, 'SK002')[0].message;
  assert.ok(message.includes('<U+0301>'), 'combining mark should be spelled out');
  assert.ok(message.includes('<U+00E9>'), 'precomposed form should be spelled out');
});

test('classifyCollision separates case, normalization, and both', () => {
  assert.equal(classifyCollision(['a', 'A']).rule.id, 'SK001');
  assert.equal(classifyCollision(['caf\u00E9', 'cafe\u0301']).rule.id, 'SK002');
  const both = classifyCollision(['cafe\u0301', 'CAF\u00C9']);
  assert.equal(both.rule.id, 'SK001');
  assert.ok(both.detail.includes('both'));
});

test('codePointSpelling keeps ASCII readable and escapes the rest', () => {
  assert.equal(codePointSpelling('cafe\u0301.md'), 'cafe<U+0301>.md');
  assert.equal(codePointSpelling('plain.txt'), 'plain.txt');
});

test('SK010 fires when a symlink takes part in a collision', () => {
  const r = scan([
    { path: 'docs/Link', mode: '120000' },
    { path: 'docs/link', mode: '100644' },
  ]);
  assert.deepEqual(rules(r), ['SK001', 'SK010']);
  assert.equal(findingsFor(r, 'SK010').length, 1);
  assert.equal(findingsFor(r, 'SK010')[0].path, 'docs/Link');
});

test('SK010 does not fire for a symlink that collides with nothing', () => {
  const r = scan([{ path: 'docs/link', mode: '120000' }, { path: 'docs/other', mode: '100644' }]);
  assert.deepEqual(r.findings, []);
});

test('collision findings list the other members in related', () => {
  const r = scan(['a.txt', 'A.txt', 'a.TXT']);
  for (const f of findingsFor(r, 'SK001')) {
    assert.equal(f.related.length, 2);
    assert.ok(!f.related.includes(f.path));
  }
});

test('duplicate input paths are de-duplicated', () => {
  const r = scan(['same.txt', 'same.txt', './same.txt', '/same.txt']);
  assert.equal(r.scanned, 1);
  assert.deepEqual(r.findings, []);
});

test('three-way collisions report every member', () => {
  const r = scan(['x/a', 'x/A', 'x/\u0041']);
  // 'A' and '\u0041' are the same string, so this is a two-way collision.
  assert.equal(findingsFor(r, 'SK001').length, 2);
});
