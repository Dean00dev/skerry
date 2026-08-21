# Marketplace listing copy

The accepted listing metadata and release copy for the next release.

## Listing title

```
Skerry Path Guard
```

GitHub accepted this name for the existing Marketplace listing. The repository
name remains `skerry`.

## Short description

Used as the `description:` in `action.yml` and shown under the title.

```
Fail the build when a filename cannot be checked out safely on Windows or macOS. Never reads scanned file contents.
```

124 characters.

## Categories

| Slot | Category |
| --- | --- |
| Primary | Code quality |
| Secondary | Utilities |

**Security is deliberately not chosen.** Three rules touch a security-adjacent
hazard class, but Skerry is not a security control and listing it as one would
be an inflated claim.

## Icon and colour

Set in `action.yml`:

```yaml
branding:
  icon: 'anchor'
  color: 'blue'
```

Marketplace renders the Feather icon named in `branding`, not an image file.
`assets/skerry-logo.svg` is for the README and for social previews.

## Long description

The Marketplace listing body is taken from `README.md` automatically. No
separate copy is needed.

## Release title

```
Skerry Path Guard v1.1.0 — Baselines and Ref Guards
```

## Release notes

```markdown
Adopt Skerry without turning an existing backlog into an instant red build—and optionally catch Windows-hostile branch and tag names before they reach somebody's checkout.

## Added

- Deterministic `write-baseline` / `baseline` adoption flow. Existing exact
  rule/path findings are counted as suppressed; anything new still fails.
- Stale baseline counts expose entries that no longer match after a fix.
- Opt-in SK012 for Git-valid branch/tag names Windows cannot represent.
- Opt-in SK013 for case/normalization ref collisions within the same namespace.
- Ref and baseline coverage in outputs, summaries and deterministic JSON receipts.

## Boundaries

- `check-refs` is off by default, so existing pinned v1 workflows retain their
  v1.0 path-only result until they opt in.
- Ref checks use local refs and the pull-request head only. No network calls.
- A baseline records identity, not whether an exception is justified or safe.
- Ref SARIF results deliberately carry no fabricated physical file location.

## Verification

- 196 automated tests pass with zero failures.
- All nine Ubuntu, macOS and Windows × Node 20, 22 and 24 test cells pass.
- All 15 hosted CI jobs pass, including live baseline round-trip and hostile-ref
  integration gates.
- Zero runtime dependencies; Node standard library only.

See `VERIFICATION.md` for the reconciled archive/live history, disclosed
regressions avoided, hosted run, and remaining boundaries.
```

## Topics to add to the repository

```
github-actions  ci  filenames  cross-platform  windows  macos  unicode
repository-hygiene  developer-tools  portability
```
