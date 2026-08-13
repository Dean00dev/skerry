'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  compilePattern,
  compileAll,
  matchesAny,
  parsePatternList,
  PatternError,
  MAX_PATTERN_LENGTH,
  MAX_PATTERNS,
} = require('../src/match');

function m(patterns, path) {
  return matchesAny(compileAll(patterns), path);
}

test('literal path matches exactly', () => {
  assert.equal(m(['docs/readme.md'], 'docs/readme.md'), true);
  assert.equal(m(['docs/readme.md'], 'docs/readme.md.bak'), false);
  assert.equal(m(['docs/readme.md'], 'other/docs/readme.md'), false);
});

test('single star does not cross a slash', () => {
  assert.equal(m(['docs/*.md'], 'docs/a.md'), true);
  assert.equal(m(['docs/*.md'], 'docs/nested/a.md'), false);
});

test('double star crosses slashes', () => {
  assert.equal(m(['docs/**/*.md'], 'docs/nested/deep/a.md'), true);
  assert.equal(m(['**/vendor/**'], 'a/b/vendor/c/d.js'), true);
});

test('question mark matches exactly one non-slash character', () => {
  assert.equal(m(['a?.txt'], 'ab.txt'), true);
  assert.equal(m(['a?.txt'], 'abc.txt'), false);
  assert.equal(m(['a?.txt'], 'a/.txt'), false);
});

test('bare pattern with no slash also matches the basename', () => {
  assert.equal(m(['*.png'], 'assets/images/logo.png'), true);
  assert.equal(m(['logo.png'], 'assets/logo.png'), true);
  assert.equal(m(['assets/logo.png'], 'nested/assets/logo.png'), false);
});

test('trailing slash matches the directory and everything under it', () => {
  assert.equal(m(['vendor/'], 'vendor'), true);
  assert.equal(m(['vendor/'], 'vendor/lib/a.js'), true);
  assert.equal(m(['vendor/'], 'vendored/lib/a.js'), false);
});

test('leading ./ and / are normalised away', () => {
  assert.equal(m(['./docs/a.md'], 'docs/a.md'), true);
  assert.equal(m(['/docs/a.md'], 'docs/a.md'), true);
});

test('regex metacharacters in a pattern are literal', () => {
  assert.equal(m(['a+b.txt'], 'a+b.txt'), true);
  assert.equal(m(['a+b.txt'], 'aab.txt'), false);
  assert.equal(m(['file(1).txt'], 'file(1).txt'), true);
  assert.equal(m(['a.b'], 'axb'), false);
});

test('runs of three or more stars collapse rather than nesting quantifiers', () => {
  const compiled = compilePattern('***/x');
  assert.equal(compiled.regex.source, '^.*\\/x$');
});

test('a pathological pattern still terminates promptly', () => {
  const pattern = `${'**/'.repeat(60)}target`;
  const subject = `${'a'.repeat(4000)}`;
  const compiled = compileAll([pattern]);
  const started = Date.now();
  assert.equal(matchesAny(compiled, subject), false);
  assert.ok(Date.now() - started < 1000, 'matcher should not blow up on adversarial input');
});

test('over-long patterns are rejected', () => {
  assert.throws(() => compilePattern('a'.repeat(MAX_PATTERN_LENGTH + 1)), PatternError);
});

test('too many patterns are rejected', () => {
  const many = Array.from({ length: MAX_PATTERNS + 1 }, (_, i) => `p${i}`);
  assert.throws(() => compileAll(many), PatternError);
});

test('NUL in a pattern is rejected', () => {
  assert.throws(() => compilePattern('a\u0000b'), PatternError);
});

test('pattern lists split on newlines and commas and drop comments', () => {
  assert.deepEqual(parsePatternList('a\nb, c\n# note\n\n d '), ['a', 'b', 'c', 'd']);
  assert.deepEqual(parsePatternList(''), []);
  assert.deepEqual(parsePatternList(undefined), []);
});

test('empty pattern set matches nothing', () => {
  assert.equal(matchesAny([], 'anything'), false);
});
