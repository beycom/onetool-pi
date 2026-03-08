# Release Process

## Prerequisites

- npm account with publish access to the `onetool-pi` package
- GitHub CLI (`gh`) installed and authenticated
- Git remote `origin` pointing to `github.com/beycom/onetool-pi`

## Steps

### 1. Dry run (optional)

Preview what will be packed and published without making any changes:

```bash
just release-dry <version>
# e.g. just release-dry 1.1.0
```

### 2. Full release

Run everything in one command — bumps the version, runs checks, commits, tags, pushes, publishes to npm, and creates a GitHub release:

```bash
just release <version>
# e.g. just release 1.1.0
```

This runs in order:
1. `just release-prep <version>` — sets version in `package.json` (no git tag yet)
2. `just release-check` — typecheck + tests
3. `git add package.json && git commit` — commits the version bump
4. `git tag -a v<version>` — creates an annotated tag
5. `git push origin main` + `git push origin v<version>` — pushes branch and tag
6. `npm publish` — publishes to the npm registry
7. `gh release create` — creates a GitHub release with auto-generated notes

### 3. Rollback a bad release

If something went wrong after publishing:

```bash
just release-delete <version>
# e.g. just release-delete 1.1.0
```

This deletes the GitHub release and the git tag (local and remote). To unpublish from npm, run:

```bash
npm unpublish onetool-pi@<version>
```

> npm only allows unpublishing within 72 hours of publishing.

## Version conventions

Follow [Semantic Versioning](https://semver.org/):

- `PATCH` (e.g. `1.0.1`) — bug fixes, no behaviour change
- `MINOR` (e.g. `1.1.0`) — new features, backward-compatible
- `MAJOR` (e.g. `2.0.0`) — breaking changes

## Notes

- `prepublishOnly` in `package.json` runs typecheck, tests, and build before every `npm publish`. The `just release` command runs these explicitly before publishing as a double-check.
- Never skip checks with `--ignore-scripts` unless you are certain the build is clean.
- The commit message format is `chore: release v<version>`.
