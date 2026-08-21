# Release checklist

Every step here is performed by the repository owner. Nothing in this project
publishes, pushes, or registers anything by itself.

## Before the repository exists

- [ ] All gates pass locally: `npm test`, `npm run check`, `npm run self`
- [ ] `VERIFICATION.md` reflects the current state, with real numbers
- [ ] `src/constants.js` `VERSION`, `package.json` `version`, and the
      `CHANGELOG.md` heading all agree — the metadata checker enforces this
- [ ] No `node_modules/`, no `dist/`, no `.git/` inside the archive
- [ ] Credential scan is clean

## Creating the repository

- [ ] Repository name: **`skerry`**
- [ ] Visibility: **Public** — Marketplace requires it
- [ ] **Do not** initialise with a README, a licence, or a .gitignore. The
      archive already contains all three, and an initialised repository forces
      a merge before the first push
- [ ] Upload the archive contents so that `action.yml` sits at the repository
      root, not inside a `skerry/` folder
- [ ] Confirm on the repository home page that `action.yml` is visible in the
      top-level file list

## Repository settings

- [ ] Settings → General → Features: enable Issues
- [ ] Settings → Security → enable **Private vulnerability reporting**.
      `SECURITY.md` and the issue template both point at it
- [ ] Add repository topics — the list is at the end of `MARKETPLACE.md`
- [ ] Confirm the CI workflow ran and every job is green **before** releasing.
      The runner is the first environment where the Action has ever executed
      as a real Action

## Publishing to Marketplace

- [ ] Open the repository's Releases page and choose **Draft a new release**
- [ ] Confirm **Publish this Action to the GitHub Marketplace** remains selected
- [ ] Confirm the accepted Marketplace name remains **Skerry Path Guard**
- [ ] Primary category: **Code quality**. Secondary: **Utilities**
- [x] Tag: `v1.0.1`
- [x] Release title and notes: copy from `MARKETPLACE.md`
- [x] Publish

## Immediately after

- [x] Create or move the major `v1` ref so `@v1` resolves. Skerry currently
      maintains this as a branch:
      `git branch -f v1 v1.0.1 && git push -f origin v1`
- [ ] Open the Marketplace listing and confirm the description and icon render
- [ ] Test the published Action from a **different** repository, pinned to
      `@v1`, and confirm it runs. Until this is done, "works as a published
      Action" is untested
- [x] Update `CHANGELOG.md` to move `1.0.1` from unreleased to the release date

## For each later release

- [ ] Bump `VERSION`, `package.json`, and `CHANGELOG.md` together
- [ ] New rules that run by default go in a **major** version. A minor release
      may add a rule only when it is disabled by default and requires opt-in
- [ ] Move the major `v1` ref after each release, or `@v1` will point at old code
- [ ] Re-run every gate; do not release on a partial run

## Deliberately not on this list

- Any form of promotion that manufactures engagement. No automated clones,
  stars, forks, views, or traffic. No asking for stars deceptively
- Any claim of endorsement by GitHub, Anthropic, OpenAI, or anyone else
- Describing the project as production-ready before it has run on a real
  runner in a real repository
