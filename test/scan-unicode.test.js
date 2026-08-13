'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { scan } = require('../src/scan');

function ruleFor(paths, rule) {
  return scan(paths).findings.filter((f) => f.rule === rule);
}

test('SK003 fires on a decomposed name', () => {
  assert.equal(ruleFor(['expose\u0301d.md'], 'SK003').length, 1);
});

test('SK003 stays quiet on a precomposed name', () => {
  assert.equal(ruleFor(['expos\u00E9d.md'], 'SK003').length, 0);
  assert.equal(ruleFor(['\u65E5\u672C\u8A9E.md'], 'SK003').length, 0);
});

test('SK009 fires on bidirectional overrides', () => {
  for (const cp of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e]) {
    const name = `invoice${String.fromCodePoint(cp)}gnp.exe`;
    assert.equal(ruleFor([name], 'SK009').length, 1, `U+${cp.toString(16)} should fire`);
  }
});

test('SK009 fires on bidirectional isolates and the Arabic letter mark', () => {
  assert.equal(ruleFor(['a\u2066b\u2069.js'], 'SK009').length, 1);
  assert.equal(ruleFor(['a\u061Cb.js'], 'SK009').length, 1);
});

test('SK009 fires on Unicode tag characters', () => {
  assert.equal(ruleFor([`file${String.fromCodePoint(0xe0041)}.txt`], 'SK009').length, 1);
});

test('SK011 fires on zero width and invisible formatting characters', () => {
  for (const cp of [0x00ad, 0x180e, 0x200b, 0x200c, 0x200e, 0x200f, 0x2060, 0xfeff]) {
    const name = `a${String.fromCodePoint(cp)}b.txt`;
    assert.equal(ruleFor([name], 'SK011').length, 1, `U+${cp.toString(16)} should fire`);
  }
});

test('U+200D zero width joiner is deliberately allowed so emoji filenames pass', () => {
  const family = 'family-\u{1F468}\u200D\u{1F469}\u200D\u{1F467}.png';
  const r = scan([family]);
  assert.deepEqual(r.findings, [], 'a legitimate emoji sequence must not be flagged');
});

test('ordinary non-ASCII filenames are not flagged', () => {
  const r = scan([
    '\u0645\u0644\u0641.txt',
    '\u6587\u4EF6.md',
    '\u0440\u0435\u0430\u0434\u043C\u0435.txt',
    'r\u00E9sum\u00E9.pdf',
    'stra\u00DFe.json',
  ]);
  assert.deepEqual(r.findings, [], 'internationalised names are legitimate');
});

test('bidi characters are errors and invisible ones are warnings', () => {
  const bidi = scan(['a\u202Eb.txt']);
  assert.equal(bidi.counts.error, 1);
  const invisible = scan(['a\u200Bb.txt']);
  assert.equal(invisible.counts.warning, 1);
  assert.equal(invisible.counts.error, 0);
});

test('a name can trigger several unicode rules at once', () => {
  const name = 'a\u202Eb\u200Bc\u0301.txt';
  const found = new Set(scan([name]).findings.map((f) => f.rule));
  assert.ok(found.has('SK009'));
  assert.ok(found.has('SK011'));
  assert.ok(found.has('SK003'));
});
