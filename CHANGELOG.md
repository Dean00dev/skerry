# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

New rules that run by default change existing results and therefore require a
major version. Minor releases may add rules only when they are opt-in.

## [1.1.0] — 2026-08-21

### Added

- Deterministic baseline creation and exact rule/path suppression, with stale
  entry counts so fixed findings can be pruned without silently widening the
  exception ledger.
- Opt-in local branch and tag checks: SK012 for Windows-incompatible ref names
  and SK013 for case/normalization collisions within a ref namespace.
- JSON receipt fields and step outputs for ref coverage and aggregate baseline
  state. Ref findings carry no fabricated file location in annotations or SARIF.

### Hardened

- Baseline operations fail closed on truncated scans, malformed counts,
  duplicate or unknown-rule entries, non-files, and bounded-size violations.
- Ref enumeration is bounded and fails closed on errors inside a detected Git
  work tree. Pull-request head refs are distinguished from GitHub's synthetic
  merge ref, and branch/tag namespaces cannot create false collisions.
- All notices continue to respect `annotations: false`; v1.0.1's source
  collection, COM0/LPT0, annotation reconciliation, and portable e2e repairs
  remain intact.

### Compatibility

- `check-refs` is `false` by default. Without baseline/ref inputs, v1.1 keeps
  v1.0's path rules, failure decisions, and clean-run wording.

### Verification

- 191 local tests pass on the reconciled candidate. Hosted GitHub Actions
  verification remains required before release.

## [1.0.1] — 2026-08-14

### Fixed

- The explanatory “Path hazards found” workflow command is now a notice rather
  than an additional error, so GitHub's error annotation total reconciles with
  Skerry's `errors` output.
- The deliberately hazardous CI self-test now emits no workflow annotations,
  avoiding intentional findings or explanatory notices being permanently
  attached to otherwise healthy commits. Its exit status and outputs remain
  asserted downstream.

### Verification

- Added seven regression tests covering annotation-count reconciliation, failure
  semantics and the negative CI job's annotation boundary.

## [1.0.0] — 2026-08-13

First public release.

### Added

- Eleven path portability rules, `SK001` through `SK011`, covering case
  collisions, Unicode normalization collisions, non-NFC names, Windows reserved
  device names, illegal characters, trailing dots and spaces, leading spaces,
  path length, bidirectional control characters, symlinks in collisions, and
  invisible formatting characters.
- Three path sources: the git index, a bounded filesystem walk, and a path
  manifest, with `auto` preferring git and announcing any fallback.
- GitHub annotations, plain text output, and a job summary table.
- JSON and SARIF 2.1.0 reports, both free of timestamps so identical input
  produces byte-identical output.
- Ten step outputs including counts, the source used, and `passed`.
- `ignore` glob patterns, per-rule `disable`, and a configurable `fail-on`
  threshold.
- Zero runtime dependencies. Node standard library only, no bundled `dist/`.

### Security

- Two-layer defence for repository-controlled filenames: display sanitisation
  of control, bidi and invisible characters, plus GitHub workflow command
  escaping. See `docs/THREAT_MODEL.md`.
- No shell is used anywhere. `git` is invoked with an argument array and the
  scan directory is passed as `cwd`, never as an argument.
- Resource caps on tree depth, entry count, pattern count, pattern length and
  findings output.

[1.1.0]: https://github.com/Dean00dev/skerry/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/Dean00dev/skerry/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Dean00dev/skerry/releases/tag/v1.0.0
