'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { resolveInputs, parseCliArgs, InputError, INPUT_NAMES } = require('../src/inputs');

test('defaults are applied when nothing is supplied', () => {
  const r = resolveInputs({}, []);
  assert.equal(r.path, '.');
  assert.equal(r.failOn, 'error');
  assert.equal(r.maxPathLength, 200);
  assert.equal(r.maxFindings, 500);
  assert.equal(r.source, 'auto');
  assert.equal(r.annotations, true);
  assert.equal(r.summary, true);
  assert.deepEqual(r.disable, []);
  assert.deepEqual(r.ignorePatterns, []);
});

test('the dashed environment variable form used by GitHub is read', () => {
  const r = resolveInputs({ 'INPUT_FAIL-ON': 'warning', 'INPUT_MAX-PATH-LENGTH': '120' }, []);
  assert.equal(r.failOn, 'warning');
  assert.equal(r.maxPathLength, 120);
});

test('the underscore environment variable form is also accepted', () => {
  const r = resolveInputs({ INPUT_FAIL_ON: 'never' }, []);
  assert.equal(r.failOn, 'never');
});

test('command line flags override the environment', () => {
  const r = resolveInputs({ 'INPUT_FAIL-ON': 'warning' }, ['--fail-on', 'never']);
  assert.equal(r.failOn, 'never');
});

test('both --key=value and --key value forms work', () => {
  assert.deepEqual(parseCliArgs(['--fail-on=never']), { 'fail-on': 'never' });
  assert.deepEqual(parseCliArgs(['--fail-on', 'never']), { 'fail-on': 'never' });
  assert.deepEqual(parseCliArgs(['--summary']), { summary: 'true' });
});

test('an unknown option is a usage error, not a silent no-op', () => {
  assert.throws(() => parseCliArgs(['--not-a-real-option', 'x']), InputError);
  assert.throws(() => parseCliArgs(['positional']), InputError);
});

test('every documented input name is accepted as a flag', () => {
  for (const name of INPUT_NAMES) {
    assert.doesNotThrow(() => parseCliArgs([`--${name}=x`]), `--${name} should be accepted`);
  }
});

test('fail-on rejects anything outside the three valid values', () => {
  assert.throws(() => resolveInputs({ 'INPUT_FAIL-ON': 'critical' }, []), InputError);
  assert.throws(() => resolveInputs({ 'INPUT_FAIL-ON': 'ERROR;rm -rf /' }, []), InputError);
});

test('fail-on is case insensitive', () => {
  assert.equal(resolveInputs({ 'INPUT_FAIL-ON': 'WARNING' }, []).failOn, 'warning');
});

test('numeric inputs reject non-numbers and out of range values', () => {
  assert.throws(() => resolveInputs({ 'INPUT_MAX-PATH-LENGTH': 'abc' }, []), InputError);
  assert.throws(() => resolveInputs({ 'INPUT_MAX-PATH-LENGTH': '1e5' }, []), InputError);
  assert.throws(() => resolveInputs({ 'INPUT_MAX-PATH-LENGTH': '-5' }, []), InputError);
  assert.throws(() => resolveInputs({ 'INPUT_MAX-PATH-LENGTH': '99999' }, []), InputError);
  assert.throws(() => resolveInputs({ 'INPUT_MAX-FINDINGS': '0' }, []), InputError);
});

test('boundary values for numeric inputs are accepted', () => {
  assert.equal(resolveInputs({ 'INPUT_MAX-PATH-LENGTH': '0' }, []).maxPathLength, 0);
  assert.equal(resolveInputs({ 'INPUT_MAX-PATH-LENGTH': '4096' }, []).maxPathLength, 4096);
  assert.equal(resolveInputs({ 'INPUT_MAX-FINDINGS': '1' }, []).maxFindings, 1);
});

test('booleans accept the usual spellings and reject the rest', () => {
  assert.equal(resolveInputs({ INPUT_SUMMARY: 'FALSE' }, []).summary, false);
  assert.equal(resolveInputs({ INPUT_SUMMARY: 'no' }, []).summary, false);
  assert.equal(resolveInputs({ INPUT_SUMMARY: '1' }, []).summary, true);
  assert.throws(() => resolveInputs({ INPUT_SUMMARY: 'maybe' }, []), InputError);
});

test('an unknown rule id in disable is rejected', () => {
  assert.throws(() => resolveInputs({ INPUT_DISABLE: 'SK999' }, []), InputError);
  assert.throws(() => resolveInputs({ INPUT_DISABLE: 'SK001,SK00l' }, []), InputError);
});

test('disable accepts lower case, spaces and commas, and de-duplicates', () => {
  const r = resolveInputs({ INPUT_DISABLE: 'sk003, SK008 SK003' }, []);
  assert.deepEqual(r.disable, ['SK003', 'SK008']);
});

test('report paths reject newlines that could break the outputs file', () => {
  assert.throws(() => resolveInputs({ 'INPUT_REPORT-JSON': 'a\nb.json' }, []), InputError);
  assert.throws(() => resolveInputs({ 'INPUT_REPORT-JSON': 'a\u0000b.json' }, []), InputError);
  assert.throws(() => resolveInputs({ 'INPUT_REPORT-JSON': 'reports/' }, []), InputError);
});

test('path input rejects newlines', () => {
  assert.throws(() => resolveInputs({ INPUT_PATH: 'a\nb' }, []), InputError);
});

test('source list without paths-file is a usage error', () => {
  assert.throws(() => resolveInputs({ INPUT_SOURCE: 'list' }, []), InputError);
});

test('source rejects unknown values', () => {
  assert.throws(() => resolveInputs({ INPUT_SOURCE: 'network' }, []), InputError);
});

test('empty environment values fall back to defaults rather than failing', () => {
  const r = resolveInputs({ 'INPUT_FAIL-ON': '', INPUT_PATH: '' }, []);
  assert.equal(r.failOn, 'error');
  assert.equal(r.path, '.');
});
