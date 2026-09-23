'use strict';

/**
 * Skerry — input handling.
 *
 * Inputs arrive either as GitHub Action environment variables (INPUT_FAIL-ON
 * and friends) or as command line flags for local use. Both go through the
 * same validation. Anything unrecognised is a usage error rather than a
 * silently ignored value, because a typo in `disable` that quietly does
 * nothing is worse than a failed build.
 */

const { RULE_IDS } = require('./constants');
const { parsePatternList } = require('./match');

class InputError extends Error {}

const FAIL_ON_VALUES = new Set(['error', 'warning', 'never']);
const SOURCE_VALUES = new Set(['auto', 'git', 'fs', 'list']);

const SPEC = {
  path: { default: '.' },
  ignore: { default: '' },
  'fail-on': { default: 'error' },
  'max-path-length': { default: '200' },
  'max-findings': { default: '500' },
  disable: { default: '' },
  annotations: { default: 'true' },
  summary: { default: 'true' },
  'report-json': { default: '' },
  'report-sarif': { default: '' },
  source: { default: 'auto' },
  'paths-file': { default: '' },
  'check-refs': { default: 'false' },
  baseline: { default: '' },
  'write-baseline': { default: '' },
};

const INPUT_NAMES = Object.freeze(Object.keys(SPEC));

function envKeyVariants(name) {
  const upper = name.toUpperCase();
  return [`INPUT_${upper}`, `INPUT_${upper.replace(/-/g, '_')}`];
}

function readRaw(name, env, cli) {
  if (Object.prototype.hasOwnProperty.call(cli, name)) return cli[name];
  for (const key of envKeyVariants(name)) {
    if (env[key] !== undefined && env[key] !== '') return env[key];
  }
  return SPEC[name].default;
}

function parseBoolean(name, value) {
  const v = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(v)) return true;
  if (['false', '0', 'no', 'off'].includes(v)) return false;
  throw new InputError(`input "${name}" must be true or false, received something else`);
}

function parseInteger(name, value, { min, max }) {
  const v = String(value).trim();
  if (!/^-?\d+$/.test(v)) {
    throw new InputError(`input "${name}" must be a whole number`);
  }
  const n = Number.parseInt(v, 10);
  if (n < min || n > max) {
    throw new InputError(`input "${name}" must be between ${min} and ${max}`);
  }
  return n;
}

function parseChoice(name, value, allowed) {
  const v = String(value).trim().toLowerCase();
  if (!allowed.has(v)) {
    throw new InputError(`input "${name}" must be one of: ${[...allowed].sort().join(', ')}`);
  }
  return v;
}

function parseRuleList(name, value) {
  const items = String(value)
    .split(/[\s,]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
  for (const item of items) {
    if (!RULE_IDS.includes(item)) {
      throw new InputError(
        `input "${name}" names an unknown rule. Known rules: ${RULE_IDS.join(', ')}`
      );
    }
  }
  return [...new Set(items)].sort();
}

/**
 * Output file paths are workflow-author supplied. They are rejected if they
 * contain a newline or NUL, because those characters would let a value break
 * out of the $GITHUB_OUTPUT file format or the log.
 */
function parseOutputPath(name, value) {
  const v = String(value).trim();
  if (v === '') return '';
  if (/[\n\r\u0000]/.test(v)) {
    throw new InputError(`input "${name}" must not contain newline or NUL characters`);
  }
  if (v.endsWith('/') || v.endsWith('\\')) {
    throw new InputError(`input "${name}" must be a file path, not a directory`);
  }
  return v;
}

/** Very small flag parser: --key=value, --key value, --key (boolean true). */
function parseCliArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      throw new InputError(`unexpected argument: ${JSON.stringify(arg.slice(0, 40))}`);
    }
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    let key;
    let value;
    if (eq !== -1) {
      key = body.slice(0, eq);
      value = body.slice(eq + 1);
    } else {
      key = body;
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        value = next;
        i += 1;
      } else {
        value = 'true';
      }
    }
    if (!Object.prototype.hasOwnProperty.call(SPEC, key)) {
      throw new InputError(
        `unknown option "--${key.slice(0, 40)}". Known options: ${INPUT_NAMES.map((n) => `--${n}`).join(' ')}`
      );
    }
    out[key] = value;
  }
  return out;
}

function resolveInputs(env = process.env, argv = []) {
  const cli = parseCliArgs(argv);
  const get = (name) => readRaw(name, env, cli);

  const source = parseChoice('source', get('source'), SOURCE_VALUES);
  const pathsFile = parseOutputPath('paths-file', get('paths-file'));
  if (source === 'list' && pathsFile === '') {
    throw new InputError('source "list" requires the paths-file input');
  }

  const scanPath = String(get('path')).trim() || '.';
  if (/[\n\r\u0000]/.test(scanPath)) {
    throw new InputError('input "path" must not contain newline or NUL characters');
  }

  const baseline = parseOutputPath('baseline', get('baseline'));
  const writeBaseline = parseOutputPath('write-baseline', get('write-baseline'));
  if (baseline && writeBaseline) {
    throw new InputError('inputs "baseline" and "write-baseline" cannot be used together');
  }

  return {
    path: scanPath,
    ignorePatterns: parsePatternList(get('ignore')),
    failOn: parseChoice('fail-on', get('fail-on'), FAIL_ON_VALUES),
    maxPathLength: parseInteger('max-path-length', get('max-path-length'), { min: 0, max: 4096 }),
    maxFindings: parseInteger('max-findings', get('max-findings'), { min: 1, max: 100000 }),
    disable: parseRuleList('disable', get('disable')),
    annotations: parseBoolean('annotations', get('annotations')),
    summary: parseBoolean('summary', get('summary')),
    reportJson: parseOutputPath('report-json', get('report-json')),
    reportSarif: parseOutputPath('report-sarif', get('report-sarif')),
    source,
    pathsFile,
    checkRefs: parseBoolean('check-refs', get('check-refs')),
    baseline,
    writeBaseline,
  };
}

module.exports = {
  resolveInputs,
  parseCliArgs,
  parseBoolean,
  parseInteger,
  parseChoice,
  parseRuleList,
  parseOutputPath,
  InputError,
  INPUT_NAMES,
  SPEC,
  FAIL_ON_VALUES,
  SOURCE_VALUES,
};
