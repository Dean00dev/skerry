'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { scan } = require('../src/scan');

function ruleFor(paths, rule) {
  return scan(paths).findings.filter((f) => f.rule === rule);
}

test('SK004 catches bare reserved names', () => {
  for (const name of ['nul', 'CON', 'Aux', 'prn', 'com1', 'LPT9']) {
    assert.equal(ruleFor([name], 'SK004').length, 1, `${name} should be reserved`);
  }
});

test('SK004 does not invent COM0 and LPT0 reserved names', () => {
  for (const name of ['COM0', 'com0.txt', 'LPT0', 'lpt0.log']) {
    assert.equal(ruleFor([name], 'SK004').length, 0, `${name} is not in Microsoft's reserved-name list`);
  }
});

test('SK004 catches reserved names with extensions', () => {
  assert.equal(ruleFor(['NUL.txt'], 'SK004').length, 1);
  assert.equal(ruleFor(['com6.foo.jpg'], 'SK004').length, 1);
});

test('SK004 catches reserved names used as directories', () => {
  const findings = ruleFor(['lib/aux/helpers.js'], 'SK004');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].path, 'lib/aux');
});

test('SK004 catches the superscript device variants', () => {
  assert.equal(ruleFor(['COM\u00B9'], 'SK004').length, 1);
  assert.equal(ruleFor(['lpt\u00B3.log'], 'SK004').length, 1);
});

test('SK004 does not fire on names that merely start with a reserved word', () => {
  for (const name of ['console.js', 'nullable.ts', 'com10.log', 'auxiliary.md', 'connection']) {
    assert.equal(ruleFor([name], 'SK004').length, 0, `${name} should be allowed`);
  }
});

test('SK004 does not fire on a dotfile', () => {
  assert.equal(ruleFor(['.gitignore'], 'SK004').length, 0);
  assert.equal(ruleFor(['.con'], 'SK004').length, 0);
});

test('SK005 catches every character Windows rejects', () => {
  const cases = {
    'a<b': '<',
    'a>b': '>',
    'a:b': ':',
    'a"b': '"',
    'a\\b': '\\',
    'a|b': '|',
    'a?b': '?',
    'a*b': '*',
  };
  for (const [name, ch] of Object.entries(cases)) {
    assert.equal(ruleFor([name], 'SK005').length, 1, `${ch} should be rejected`);
  }
});

test('SK005 catches control characters including tab and escape', () => {
  assert.equal(ruleFor(['a\tb.txt'], 'SK005').length, 1);
  assert.equal(ruleFor(['a\u001Bb.txt'], 'SK005').length, 1);
  assert.equal(ruleFor(['a\u0001b.txt'], 'SK005').length, 1);
});

test('SK005 reports each distinct offending character once', () => {
  const findings = ruleFor(['a<b<c>d'], 'SK005');
  assert.equal(findings.length, 1);
  assert.ok(findings[0].message.includes('U+003C'));
  assert.ok(findings[0].message.includes('U+003E'));
});

test('SK005 leaves ordinary punctuation alone', () => {
  assert.equal(ruleFor(['my-file_name.v2 (copy).tar.gz'], 'SK005').length, 0);
});

test('SK006 catches trailing dots and spaces', () => {
  assert.equal(ruleFor(['report.'], 'SK006').length, 1);
  assert.equal(ruleFor(['report '], 'SK006').length, 1);
  assert.equal(ruleFor(['folder. /inner.md'], 'SK006').length, 1);
});

test('SK006 leaves ordinary extensions alone', () => {
  assert.equal(ruleFor(['report.md'], 'SK006').length, 0);
});

test('SK007 catches a leading space', () => {
  const findings = ruleFor([' spaced/file.md'], 'SK007');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].path, ' spaced');
});

test('SK008 fires at or above the configured length', () => {
  const long = `${'a'.repeat(199)}.md`; // 202 characters
  const r = scan([long]);
  const findings = r.findings.filter((f) => f.rule === 'SK008');
  assert.equal(findings.length, 1);
  assert.ok(findings[0].message.includes('202'));
});

test('SK008 boundary: exactly at the limit fires, one below does not', () => {
  const atLimit = 'b'.repeat(200);
  const below = 'b'.repeat(199);
  assert.equal(scan([atLimit]).findings.filter((f) => f.rule === 'SK008').length, 1);
  assert.equal(scan([below]).findings.filter((f) => f.rule === 'SK008').length, 0);
});

test('SK008 can be switched off with maxPathLength 0', () => {
  const long = 'c'.repeat(500);
  assert.equal(scan([long], { maxPathLength: 0 }).findings.length, 0);
});

test('SK008 measures leaf paths, not directory prefixes', () => {
  const deep = `${'d'.repeat(150)}/${'e'.repeat(150)}`;
  const findings = scan([deep]).findings.filter((f) => f.rule === 'SK008');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].path, deep);
});

test('an ordinary repository produces no findings at all', () => {
  const r = scan([
    'README.md',
    'LICENSE',
    'src/index.js',
    'src/lib/parse.js',
    'docs/guide.md',
    '.github/workflows/ci.yml',
    'assets/logo.svg',
  ]);
  assert.deepEqual(r.findings, []);
  assert.equal(r.counts.total, 0);
  assert.equal(r.scanned, 7);
});
