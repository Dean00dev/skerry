# Design

## Shape

```
action.yml            Marketplace metadata, node24 entrypoint
src/index.js          orchestration, exit codes, outputs
src/inputs.js         input parsing and validation
src/sources.js        git index, filesystem walk, or path manifest
src/scan.js           the rules, as a pure function
src/render.js         annotations, log text, job summary, all escaping
src/report.js         JSON and SARIF
src/match.js          the ignore pattern matcher
src/constants.js      rule catalogue and character tables
src/baseline.js       deterministic exception ledgers
src/refs.js           bounded local branch/tag collection and checks
```

Roughly 1,000 lines of CommonJS, no dependencies, no build step, no bundler, no `dist/` directory. The published source is the running source, so anyone can read exactly what executes in their CI.

## Decisions

### The scanner is pure

`scan.js` takes a list of paths and returns findings. It does not touch the filesystem, spawn a process, or read the environment. Everything with side effects lives elsewhere.

This is not architectural tidiness for its own sake. It is what makes the failing fixtures possible — see below — and it means the entire rule surface is testable without creating a single file.

### The failing fixtures are manifests, not files

Skerry exists because some paths cannot be checked out on Windows and macOS. If this repository contained a real file named `NUL.txt` or a real case collision, **Skerry's own repository would be unclonable on exactly the platforms it protects.** Every Windows contributor would hit the bug the tool prevents, in the tool that prevents it.

So the hazardous paths live inside text files as data. The scanner cannot tell the difference between a manifest and a real checkout.

A real hazardous filename containing a bidirectional override is created during
testing in a throwaway Git repository. It is portable enough to exist on Linux,
macOS and Windows, and verifies that the git source scans tracked paths while
ignoring untracked ones. Host-illegal Windows names and case collisions remain
manifest data so the repository and test checkout stay portable.

There is a CI job that runs Skerry against its own repository and requires a clean result at `fail-on: warning`. Skerry passing its own strictest setting is a standing check that this discipline holds.

### Zero dependencies, including `@actions/core`

Most JavaScript actions use `@actions/core` for annotations and outputs. Skerry writes the workflow commands directly. Three reasons:

1. **Supply chain.** An Action runs inside other people's CI. Zero dependencies means zero transitive packages, no `dist/` bundle to audit, and nothing to keep patched.
2. **Escaping control.** The escaping applied to a hostile filename is the security boundary of this tool. It is written here, in `render.js`, where it can be read and tested, rather than delegated.
3. **No build step.** Nothing to compile means the repository can be maintained from a phone.

### Reports contain no timestamps

No timestamp, no hostname, no run id, no absolute path in the JSON report. Identical input therefore produces a byte-identical report, which makes "deterministic" a claim a test can check rather than a word in a README. `test/report.test.js` and `test/e2e.test.js` both check it.

### Failure is decided before truncation

Output is capped at `max-findings` so a pathological repository cannot flood a job log. The counts and the pass/fail decision are computed from the *complete* finding set before truncation, so capping output can never turn a failing scan green. Tested end to end.

Baseline creation and application require finding identities, not only counts.
They therefore fail closed when the finding set was truncated. A partial
baseline would be a false receipt and could turn later failures green.

### Baselines are exact exception ledgers

A baseline contains sorted `rule + path` identities and no timestamp. It does
not say a finding is acceptable or safe; it records that the finding existed at
adoption time. New identities still gate the build, while unmatched ledger
entries are counted as stale. The parser bounds bytes and entries and rejects
duplicate, unknown-rule, malformed, or count-inconsistent data.

### Ref namespaces remain separate

Opt-in ref collection uses only the runner's pull-request head and local Git
refs; it makes no network call. Branches collide only with branches and tags
only with tags. SARIF ref results deliberately carry no physical file location.

### Nodes, not files

The scanner builds a tree of every distinct path prefix. A badly named directory containing 400 files produces one finding, not 400. Each node carries a `sample` — a real leaf path beneath it — so an annotation about a directory still binds to a file the runner can resolve.

### Unknown input is an error

A typo in `disable: SK0O1` fails the step with a message listing the valid ids. It does not silently scan with that rule still on. Quietly ignoring a misconfigured safety check is worse than not having it.

### The matcher is deliberately small

`ignore` supports `*`, `**`, `?` and literals. That is all. Patterns compile to a regular expression built only from `[^/]`, `[^/]*` and `.*`, with everything else escaped, so no nested quantifier ambiguity is possible. Pattern length is capped at 512 characters and pattern count at 200. A test throws 60 nested `**/` at a 4,000 character subject and asserts the matcher returns in under a second.

Full gitignore semantics — negation, `!` re-inclusion, nested `.gitignore` precedence — were considered and rejected. Implementing them correctly is a project in itself, and implementing them *almost* correctly would produce a tool that silently skips files people believe are being checked.

### Sources, in order

| Source | Sees | Notes |
| --- | --- | --- |
| `git` | tracked paths, with file modes | `git ls-files -s -z`, run through `execFileSync` with an argument array. No shell. The directory is passed as `cwd`, never as an argument, so a directory named `--upload-pack=…` cannot be read as an option. There is a test for exactly that. |
| `fs` | everything on disk except a top-level `.git` | Streams directory entries rather than loading a whole directory at once. Symlinks are recorded, never followed. |
| `list` | a path manifest | Used by the test suite; also useful for checking a path list with no checkout. The manifest is size-capped before it is read. |

All three sources fail closed above 500,000 entries or 100 directory levels.
Git output and list manifests are each capped at 256 MiB.

`auto` uses `git` inside a work tree and `fs` otherwise, emitting a notice when
it chooses `fs` because that changes what is scanned. Once a work tree has been
detected, a `git ls-files` error fails the scan rather than falling back: a
fallback after a collection error could turn an incomplete check into a green
one.

## Determinism

Findings sort by severity, then path, then rule id, then message, all in UTF-16 code unit order with no locale involvement. Input order does not affect output; `test/scan-options.test.js` reverses the input and asserts identical results.

The one honest caveat: results depend on the Unicode data of the host's JavaScript engine. A future Node release with updated case mapping could in principle change a marginal SK001 result. This is noted in `README.md` under case folding being approximate.

## Adding a rule

1. Add it to `RULES` in `src/constants.js` with the next free id.
2. Implement it in `segmentFindings` or `collisionFindings` in `src/scan.js`.
3. Add a fixture manifest under `fixtures/unsafe/` and register it in `test/fixtures.test.js`.
4. Add positive **and negative** tests — the negative ones matter more, because a rule that fires on legitimate names is worse than no rule.
5. Document it in `docs/RULES.md`, including when it is wrong, and add it to the README table.
6. Run `npm run verify`. The metadata checker fails if a rule is undocumented.

New rules change results for existing users, so they ship in a major version.
