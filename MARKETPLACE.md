# Marketplace listing copy

The accepted listing metadata and release copy for the next patch release.

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
Skerry Path Guard v1.0.1 — Annotation integrity repairs
```

## Release notes

```markdown
Patch release repairing the integrity of GitHub workflow annotations.

## Fixed

- GitHub's error-annotation total now matches Skerry's `errors` output. The
  explanatory “Path hazards found” line is no longer counted as another error.
- The deliberately failing CI self-test no longer attaches expected findings or
  explanatory notices to otherwise healthy commits.
- `annotations: false` now suppresses every workflow annotation command while
  preserving Skerry's exit code, outputs and build-gating behaviour.

## Verification

- 176 automated tests pass with zero failures.
- All nine Ubuntu, macOS and Windows × Node 20, 22 and 24 test cells pass.
- Four live integration jobs pass.
- GitHub's check-run API reports zero annotations for the intentional failure
  job.

No rules, defaults, inputs or runtime dependencies changed in this patch.
See `VERIFICATION.md` for the disclosed run history and remaining boundaries.
```

## Topics to add to the repository

```
github-actions  ci  filenames  cross-platform  windows  macos  unicode
repository-hygiene  developer-tools  portability
```
