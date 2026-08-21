<p align="center">
  <img src="assets/skerry-logo.svg" alt="Skerry" width="120" height="120">
</p>

# Skerry

**Someone opens a pull request adding `src/Utils/config.json`. Your repository already has `src/utils/config.json`. CI is green. It merges.**

Every contributor on Windows and most on macOS now silently gets one of those two files, chosen for them by their filesystem. Git prints a warning during clone that nobody reads. The bug report arrives four days later and mentions none of this.

Skerry catches that in the pull request, where it is a one-line fix.

```yaml
- uses: actions/checkout@v6
- uses: Dean00dev/skerry@v1
```

That is the whole setup. No token, no secrets, no network calls, no runtime dependencies.

---

## What it checks

Skerry reads **path names only**. It never opens a scanned repository file, so it never sees your source code. The optional `list` source reads only the path manifest you explicitly provide.

| Rule | Severity | What it catches |
| --- | --- | --- |
| `SK001` | error | Two sibling paths differing only by letter case |
| `SK002` | error | Two sibling paths differing only by Unicode normalization |
| `SK003` | warning | A path segment not in Unicode NFC form |
| `SK004` | error | Windows reserved device names: `nul`, `CON`, `aux`, `com1`, `LPT9`… |
| `SK005` | error | Characters Windows cannot store: `< > : " \ \| ? *` and control characters |
| `SK006` | error | A segment ending in a dot or a space |
| `SK007` | warning | A segment beginning with a space |
| `SK008` | warning | A path long enough to risk the Windows 260 character limit |
| `SK009` | error | Bidirectional overrides and Unicode tag characters that hide the real name |
| `SK010` | error | A symlink taking part in a case or normalization collision |
| `SK011` | warning | Zero-width and invisible formatting characters |
| `SK012` | error | Branch or tag components Windows cannot represent *(opt-in)* |
| `SK013` | error | Branch or tag names colliding by case or normalization *(opt-in)* |

Full descriptions, rationale and false-positive notes: [docs/RULES.md](docs/RULES.md).

## What it looks like when it fires

```
::error title=Skerry SK001 case-collision,file=src/Utils,line=1,col=1::Two sibling
paths differ only by letter case. Collides with: src/utils. These names differ only
by letter case.
```

Findings appear as inline annotations on the pull request and as a table in the job summary. Exit code 1 fails the step.

## Usage

### Typical

```yaml
name: Path check
on: [push, pull_request]

permissions:
  contents: read

jobs:
  skerry:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: Dean00dev/skerry@v1
```

### Configured

```yaml
- uses: Dean00dev/skerry@v1
  with:
    ignore: |
      vendor/
      third_party/**
      *.snapshot
    fail-on: warning
    max-path-length: 180
    disable: SK003
    report-json: skerry-report.json
```

### Report as a step output

```yaml
- uses: Dean00dev/skerry@v1
  id: skerry
  with:
    fail-on: never
- run: echo "Skerry found ${{ steps.skerry.outputs.errors }} error(s)"
```

### Adopt without failing on existing findings

First create and commit a deterministic baseline:

```yaml
- uses: Dean00dev/skerry@v1
  with:
    write-baseline: .skerry-baseline.json
```

Then gate only findings that are not in that exact rule/path ledger:

```yaml
- uses: Dean00dev/skerry@v1
  with:
    baseline: .skerry-baseline.json
    check-refs: true
```

Skerry reports aggregate suppressed and stale counts. A baseline is not an
allowlist or a safety verdict; stale entries should be removed, and baseline
creation fails closed if the finding list was truncated.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `path` | `.` | Directory to scan, relative to the workspace. |
| `ignore` | *(empty)* | Newline or comma separated glob patterns to exclude. Supports `*`, `**` and `?`. A trailing `/` matches a directory and everything under it. |
| `fail-on` | `error` | Threshold that fails the step: `error`, `warning`, or `never`. |
| `max-path-length` | `200` | Length that triggers SK008. `0` disables the check. |
| `max-findings` | `500` | Maximum findings printed. Counts and the pass/fail decision always use the full set. |
| `disable` | *(empty)* | Comma separated rule ids to switch off, for example `SK003,SK008`. |
| `annotations` | `true` | Emit GitHub annotations. `false` gives plain text log output. |
| `summary` | `true` | Write a table to the job summary. |
| `report-json` | *(empty)* | Write a JSON report to this path. |
| `report-sarif` | *(empty)* | Write a SARIF 2.1.0 report to this path. Uploading it is your choice and needs your own `security-events` permission. |
| `source` | `auto` | Where the path list comes from: `auto`, `git`, `fs`, or `list`. |
| `paths-file` | *(empty)* | Newline separated path manifest, required when `source` is `list`. |
| `check-refs` | `false` | Check local branches and tags with opt-in SK012/SK013. No network calls are made. |
| `baseline` | *(empty)* | Suppress exact rule/path identities recorded in a Skerry baseline. |
| `write-baseline` | *(empty)* | Write a deterministic baseline of current findings and exit 0. |

An unknown value for any input is a usage error, not a silent default. A typo in `disable` fails the step rather than quietly doing nothing.

## Outputs

| Output | Description |
| --- | --- |
| `findings` | Total number of findings. |
| `errors` | Number of error severity findings. |
| `warnings` | Number of warning severity findings. |
| `notices` | Number of notice severity findings. |
| `scanned` | Paths scanned after ignore patterns were applied. |
| `ignored` | Paths excluded by ignore patterns. |
| `refs-scanned` | Local branch and tag refs scanned; `0` when ref checks are off. |
| `baselined` | Findings suppressed by the configured baseline. |
| `baseline-stale` | Baseline entries that no longer match a finding. |
| `passed` | `true` when the scan is below the threshold, otherwise `false`. |
| `source` | The path source actually used: `git`, `fs`, or `list`. |
| `report-json-path` | Absolute path of the JSON report, or empty. |
| `report-sarif-path` | Absolute path of the SARIF report, or empty. |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Nothing at or above the `fail-on` threshold |
| 1 | Findings at or above the threshold |
| 2 | Usage error: bad input, unreadable path, wrong source |
| 3 | Internal error |

## Permissions

```yaml
permissions:
  contents: read
```

`contents: read` is required by `actions/checkout`, not by Skerry. Skerry makes no GitHub API calls, reads no `GITHUB_TOKEN`, and needs no secrets. If the tree is already present it runs correctly under `permissions: {}`.

## Running it locally

```bash
node src/index.js --path . --fail-on warning
node src/index.js --source list --paths-file my-paths.txt
```

Same code, same rules, same exit codes.

## Known limitations

These are real. Read them before trusting the result.

- **Names only.** Skerry never opens a scanned repository file. It cannot detect anything about file contents, including the Trojan Source class of attack inside source code. The optional `list` source necessarily reads its caller-supplied path manifest.
- **Case folding is approximate.** Skerry uses JavaScript's Unicode case mapping. NTFS and APFS use their own tables and diverge at the edges, such as the Turkish dotless ı and the Kelvin sign. A collision Skerry reports is a collision on most systems, not provably a collision on all of them.
- **Normalization is approximate.** Behaviour differs between HFS+ and APFS and across macOS versions. SK002 identifies the hazard shape, not a guaranteed outcome on a specific machine.
- **`max-path-length` is a heuristic.** The real Windows limit depends on where the repository is cloned and whether long paths are enabled. The default of 200 leaves room for a typical clone directory; it is not a measurement.
- **Only locally available state.** Shallow and sparse checkouts, ignored files, remote-only refs, and submodule interiors are invisible. SK012/SK013 inspect local refs only and are off by default.
- **Requires git for the best results.** Without a git work tree, Skerry walks the filesystem instead and will then also see untracked and ignored files. It says so in the log when this happens.
- **Non-UTF-8 filenames degrade.** A path that is not valid UTF-8 is decoded with replacement characters, which may change how it is reported.
- **Some repositories will disagree with it.** Projects that target Linux exclusively sometimes contain deliberate case collisions or a file named `aux.c`. Use `ignore` or `disable`; do not fight the tool.
- **Opt-in rules still need review.** SK012/SK013 were added in a minor release only because `check-refs` defaults to `false`; pinned users retain the v1.0 path-only result unless they opt in.

## What Skerry is not

It is not a security tool. SK009, SK010 and SK011 touch a security-adjacent hazard class and the [threat model](docs/THREAT_MODEL.md) explains how Skerry defends its own output against hostile filenames — but a clean Skerry run establishes nothing about whether your repository is safe. It establishes that your filenames are portable.

## Prior art

Skerry did not invent this problem and does not pretend to. [pre-commit-hooks](https://github.com/pre-commit/pre-commit-hooks) has shipped `check-case-conflict` and `check-illegal-windows-names` for years and they are good hooks. If you already run pre-commit in CI, you already have most of SK001, SK004, SK005 and SK006.

What Skerry adds: no Python and no framework setup, Unicode normalization collisions, a path length budget, deceptive-character detection, per-file annotations with stable rule ids, and a machine readable report.

## Documentation

- [docs/RULES.md](docs/RULES.md) — every rule, why it exists, when it is wrong
- [docs/DESIGN.md](docs/DESIGN.md) — architecture and the decisions behind it
- [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) — attacker model and residual risk
- [VERIFICATION.md](VERIFICATION.md) — what was tested, what was simulated, what was not
- [SECURITY.md](SECURITY.md) — reporting a vulnerability
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to add a rule

## Provenance

This project was conceived and directed by Dean Egan and implemented through an AI-assisted build workflow with Claude (Anthropic), then independently reviewed and integrated with assistance from ChatGPT (OpenAI) before publication. Dean Egan is the accountable repository owner.

The tests and repository artefacts are the executable evidence. Provenance is not a substitute for independent review — read [VERIFICATION.md](VERIFICATION.md), which separates what was actually executed from what was only simulated.

Neither Anthropic, OpenAI, GitHub, nor any other company endorses this project.

## Licence

MIT © 2026 Dean Egan. See [LICENSE](LICENSE).
