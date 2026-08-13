'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { fromList } = require('../src/sources');
const { scan } = require('../src/scan');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

function rulesIn(file) {
  const { entries } = fromList(path.join(FIXTURES, file));
  const result = scan(entries);
  return {
    rules: [...new Set(result.findings.map((f) => f.rule))].sort(),
    result,
  };
}

test('the safe fixture is completely clean', () => {
  const { rules, result } = rulesIn('safe/paths.txt');
  assert.deepEqual(rules, []);
  assert.equal(result.counts.total, 0);
  assert.ok(result.scanned > 10, 'the safe fixture should be a realistic size');
});

const EXPECTED = {
  'unsafe/case-collision.txt': ['SK001'],
  'unsafe/unicode-collision.txt': ['SK002', 'SK003'],
  'unsafe/windows-reserved.txt': ['SK004'],
  'unsafe/illegal-characters.txt': ['SK005'],
  'unsafe/trailing-and-leading.txt': ['SK006', 'SK007'],
  'unsafe/long-path.txt': ['SK008'],
  'unsafe/deceptive.txt': ['SK009', 'SK011'],
  'unsafe/symlink-collision.txt': ['SK001', 'SK010'],
};

for (const [file, expected] of Object.entries(EXPECTED)) {
  test(`${file} triggers exactly ${expected.join(', ')}`, () => {
    const { rules } = rulesIn(file);
    assert.deepEqual(rules, expected);
  });
}

test('the injection fixture is caught rather than executed', () => {
  const { rules, result } = rulesIn('unsafe/injection.txt');
  assert.ok(rules.includes('SK005'));
  assert.ok(result.counts.error > 0);
});

test('every failing fixture actually fails', () => {
  for (const file of Object.keys(EXPECTED)) {
    const { result } = rulesIn(file);
    assert.ok(result.counts.total > 0, `${file} should produce findings`);
  }
});

test('the emoji filename inside the deceptive fixture is not flagged', () => {
  const { result } = rulesIn('unsafe/deceptive.txt');
  const flagged = result.findings.map((f) => f.path);
  assert.ok(
    !flagged.some((p) => p.includes('family-')),
    'a legitimate emoji sequence must survive the deceptive-character rules'
  );
});
