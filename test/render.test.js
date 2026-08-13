'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  sanitizeDisplay,
  escapeData,
  escapeProperty,
  isAnnotatablePath,
  renderAnnotation,
  renderAnnotations,
  renderSummary,
  escapeMarkdownCell,
  MAX_DISPLAY_LENGTH,
} = require('../src/render');
const { scan } = require('../src/scan');

test('escapeData follows the documented workflow command escaping', () => {
  assert.equal(escapeData('100%'), '100%25');
  assert.equal(escapeData('a\nb'), 'a%0Ab');
  assert.equal(escapeData('a\rb'), 'a%0Db');
});

test('escapeProperty additionally escapes colon and comma', () => {
  assert.equal(escapeProperty('a:b,c'), 'a%3Ab%2Cc');
  assert.equal(escapeProperty('50%,x'), '50%25%2Cx');
});

test('sanitizeDisplay neutralises ANSI escape sequences', () => {
  const out = sanitizeDisplay('\u001B[31mred\u001B[0m');
  assert.ok(!out.includes('\u001B'));
  assert.ok(out.includes('<U+001B>'));
});

test('sanitizeDisplay neutralises bidi overrides and zero width characters', () => {
  assert.equal(sanitizeDisplay('a\u202Eb'), 'a<U+202E>b');
  assert.equal(sanitizeDisplay('a\u200Bb'), 'a<U+200B>b');
  assert.equal(sanitizeDisplay('a\u0000b'), 'a<U+0000>b');
});

test('sanitizeDisplay leaves ordinary text and emoji joiners intact', () => {
  assert.equal(sanitizeDisplay('src/index.js'), 'src/index.js');
  assert.equal(sanitizeDisplay('\u{1F468}\u200D\u{1F469}'), '\u{1F468}\u200D\u{1F469}');
});

test('sanitizeDisplay caps runaway length', () => {
  const out = sanitizeDisplay('x'.repeat(MAX_DISPLAY_LENGTH * 3));
  assert.ok(out.length < MAX_DISPLAY_LENGTH + 40);
  assert.ok(out.endsWith('[truncated]'));
});

test('a filename cannot forge a second workflow command', () => {
  const r = scan(['evil/::add-mask::hunter2.txt']);
  const lines = renderAnnotations(r.findings);
  assert.ok(lines.length > 0);
  for (const line of lines) {
    const body = line.slice(line.indexOf('::', 2) + 2);
    assert.ok(!body.includes('::add-mask'), 'the forged command must not survive into the message');
    assert.equal(line.split('\n').length, 1, 'an annotation is always exactly one line');
  }
});

test('a filename containing a newline cannot break out of the annotation line', () => {
  const finding = {
    rule: 'SK005',
    name: 'windows-illegal-character',
    severity: 'error',
    path: 'a\n::add-mask::secret',
    file: 'a\n::add-mask::secret',
    message: 'test\nmessage',
  };
  const line = renderAnnotation(finding);
  assert.equal(line.split('\n').length, 1);
  assert.ok(line.includes('%0A') || line.includes('<U+000A>'));
});

test('a path with control characters is annotated without a file property', () => {
  const finding = {
    rule: 'SK005',
    name: 'windows-illegal-character',
    severity: 'error',
    path: 'bad\u0001name.txt',
    file: 'bad\u0001name.txt',
    message: 'Segment contains illegal character(s): U+0001.',
  };
  const line = renderAnnotation(finding);
  assert.ok(!line.includes('file='), 'must not bind an annotation to an unresolvable path');
  assert.ok(line.includes('cannot be annotated inline'));
});

test('isAnnotatablePath rejects control characters and absurd lengths', () => {
  assert.equal(isAnnotatablePath('src/a.txt'), true);
  assert.equal(isAnnotatablePath('a\nb'), false);
  assert.equal(isAnnotatablePath('a\u0000b'), false);
  assert.equal(isAnnotatablePath('a'.repeat(2000)), false);
  assert.equal(isAnnotatablePath(''), false);
  assert.equal(isAnnotatablePath(null), false);
});

test('percent signs and commas in a filename survive without breaking properties', () => {
  const r = scan(['evil/100%-complete,really:x.md']);
  const line = renderAnnotation(r.findings[0]);
  assert.ok(line.includes('%25'));
  const propsSection = line.slice(0, line.indexOf('::', 2));
  const fileProp = propsSection.split(',').find((p) => p.startsWith('file='));
  assert.ok(fileProp, 'file property should still parse as a single property');
  assert.ok(!fileProp.includes(','));
});

test('annotation severity maps to the right workflow command', () => {
  const base = { rule: 'SK001', name: 'x', path: 'a', file: 'a', message: 'm' };
  assert.ok(renderAnnotation({ ...base, severity: 'error' }).startsWith('::error '));
  assert.ok(renderAnnotation({ ...base, severity: 'warning' }).startsWith('::warning '));
  assert.ok(renderAnnotation({ ...base, severity: 'notice' }).startsWith('::notice '));
});

test('markdown cells escape pipes, backticks and angle brackets', () => {
  assert.equal(escapeMarkdownCell('a|b'), 'a\\|b');
  assert.equal(escapeMarkdownCell('`code`'), '\\`code\\`');
  assert.equal(escapeMarkdownCell('<b>'), '&lt;b&gt;');
});

test('a filename cannot inject a table row into the job summary', () => {
  const r = scan(['evil/a|b|c.txt']);
  const summary = renderSummary(r, { source: 'list' });
  const rows = summary.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| ---'));
  for (const row of rows) {
    const unescaped = row.replace(/\\\|/g, '');
    assert.equal(unescaped.split('|').length - 1, 5, 'each row keeps exactly five cell borders');
  }
});

test('a clean summary states the good news plainly', () => {
  const summary = renderSummary(scan(['ok.txt']), { source: 'git' });
  assert.ok(summary.includes('No path hazards found.'));
  assert.ok(!summary.includes('| Severity |'));
});

test('the summary explains every rule it triggered', () => {
  const summary = renderSummary(scan(['nul', 'a.txt', 'A.txt']), { source: 'git' });
  assert.ok(summary.includes('SK004'));
  assert.ok(summary.includes('SK001'));
  assert.ok(summary.includes('Rules triggered'));
});
