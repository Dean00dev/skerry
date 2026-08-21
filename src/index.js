'use strict';

/**
 * Skerry — entrypoint.
 *
 * Exit codes:
 *   0  no findings at or above the fail-on threshold
 *   1  findings at or above the threshold
 *   2  usage error (bad input, unreadable path, wrong source)
 *   3  internal error
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { EXIT, TOOL_NAME, VERSION, SEVERITY_RANK } = require('./constants');
const { resolveInputs, InputError } = require('./inputs');
const { compileAll, PatternError } = require('./match');
const { collect, SourceError } = require('./sources');
const { scan } = require('./scan');
const { renderAnnotations, renderConsole, renderSummary, sanitizeDisplay } = require('./render');
const { buildJsonReport, buildSarifReport } = require('./report');

function out(line) {
  process.stdout.write(`${line}\n`);
}

function commandError(message) {
  out(`::error title=Skerry::${String(message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);
}

/**
 * $GITHUB_OUTPUT uses a heredoc form with a random delimiter. Values here are
 * numbers and validated paths, but the delimiter is generated per run anyway
 * so that no value can ever close the block early.
 */
function writeOutputs(values) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const delimiter = `skerry_${crypto.randomBytes(16).toString('hex')}`;
  let block = '';
  for (const [key, value] of Object.entries(values)) {
    block += `${key}<<${delimiter}\n${String(value)}\n${delimiter}\n`;
  }
  try {
    fs.appendFileSync(file, block, 'utf8');
  } catch (err) {
    commandError(`could not write step outputs: ${String(err.message).slice(0, 120)}`);
  }
}

function writeSummary(text) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try {
    fs.appendFileSync(file, `${text}\n`, 'utf8');
  } catch (err) {
    commandError(`could not write job summary: ${String(err.message).slice(0, 120)}`);
  }
}

function writeReport(file, data, label) {
  const target = path.resolve(process.cwd(), file);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    return target;
  } catch (err) {
    throw new SourceError(`could not write ${label} report: ${String(err.message).slice(0, 160)}`);
  }
}

/**
 * Failure is decided from the full counts, not the truncated finding list, so
 * capping output can never turn a failing scan green.
 */
function isFailing(counts, failOn) {
  if (failOn === 'never') return false;
  const threshold = SEVERITY_RANK[failOn];
  return Object.entries(counts).some(
    ([severity, n]) => severity !== 'total' && n > 0 && SEVERITY_RANK[severity] >= threshold
  );
}

function run(argv) {
  const inputs = resolveInputs(process.env, argv);
  const compiled = compileAll(inputs.ignorePatterns);
  const scanDir = path.resolve(process.cwd(), inputs.path);

  const collected = collect({
    source: inputs.source,
    dir: scanDir,
    pathsFile: inputs.pathsFile,
  });

  if (collected.fellBack) {
    out(
      '::notice title=Skerry::No git work tree detected, so the filesystem was walked instead. Untracked and ignored files are included in this mode.'
    );
  }

  const result = scan(collected.entries, {
    disable: inputs.disable,
    ignore: compiled,
    maxPathLength: inputs.maxPathLength,
    maxFindings: inputs.maxFindings,
  });

  if (inputs.annotations) {
    for (const line of renderAnnotations(result.findings)) out(line);
  } else {
    for (const line of renderConsole(result)) out(line);
  }

  if (result.truncated) {
    out(
      `::notice title=Skerry::Output truncated at ${inputs.maxFindings} findings. ${result.total} findings were detected in total.`
    );
  }

  const meta = {
    source: collected.source,
    maxPathLength: inputs.maxPathLength,
    failOn: inputs.failOn,
    disabled: inputs.disable,
    ignorePatterns: inputs.ignorePatterns,
  };

  let jsonPath = '';
  let sarifPath = '';
  if (inputs.reportJson) jsonPath = writeReport(inputs.reportJson, buildJsonReport(result, meta), 'JSON');
  if (inputs.reportSarif) sarifPath = writeReport(inputs.reportSarif, buildSarifReport(result), 'SARIF');

  if (inputs.summary) writeSummary(renderSummary(result, meta));

  const failing = isFailing(result.counts, inputs.failOn);

  writeOutputs({
    findings: result.counts.total,
    errors: result.counts.error,
    warnings: result.counts.warning,
    notices: result.counts.notice,
    scanned: result.scanned,
    ignored: result.ignored,
    passed: failing ? 'false' : 'true',
    source: collected.source,
    'report-json-path': jsonPath,
    'report-sarif-path': sarifPath,
  });

  const headline = result.counts.total === 0
    ? `${TOOL_NAME} ${VERSION}: scanned ${result.scanned} path(s), no hazards found.`
    : `${TOOL_NAME} ${VERSION}: scanned ${result.scanned} path(s), ${result.counts.error} error(s), ${result.counts.warning} warning(s).`;
  out(headline);

  if (failing) {
    if (inputs.annotations) {
      // This explains the failing result; it is not another finding. Emitting
      // it as an error made GitHub's annotation total exceed the `errors`
      // output by one. The exit code below still fails the step.
      out(
        '::notice title=Skerry::Path hazards found. See the annotations above, or run this Action with fail-on: warning|never to change the threshold.'
      );
    }
    return EXIT.FINDINGS;
  }
  return EXIT.OK;
}

function main() {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (err) {
    if (err instanceof InputError || err instanceof PatternError || err instanceof SourceError) {
      commandError(sanitizeDisplay(err.message));
      process.exitCode = EXIT.USAGE;
      return;
    }
    commandError(`internal error: ${sanitizeDisplay(String(err && err.message).slice(0, 200))}`);
    process.exitCode = EXIT.INTERNAL;
  }
}

if (require.main === module) main();

module.exports = { run, main };
