default: install typecheck test

install:
    npm install

test:
    npm run test

test-e2e:
    npm run test:e2e

typecheck:
    npm run typecheck

# Bump version in package.json (no git tag yet)
release-prep version:
    npm version {{ version }} --no-git-tag-version --allow-same-version
    @echo "Version set to {{ version }}. Review, then: just release-check"

# Run all pre-release checks
release-check:
    just typecheck
    just test

# Dry-run: preview what will be published
release-dry version:
    just release-prep {{ version }}
    npm pack --dry-run

# Full release: bump, check, publish, tag, push, GitHub release
release version:
    just release-prep {{ version }}
    just release-check
    git add package.json
    git commit -m "chore: release v{{ version }}"
    git tag -a "v{{ version }}" -m "Release v{{ version }}"
    git push origin main
    git push origin "v{{ version }}"
    npm publish
    gh release create "v{{ version }}" --title "v{{ version }}" --generate-notes

# Delete a release (escape hatch)
release-delete version:
    gh release delete "v{{ version }}" --yes || true
    git push origin --delete "v{{ version }}" || true
    git tag -d "v{{ version }}" || true

npm-login:
    npm login

build:
    npm run build

install-local:
    npm pack
    pi install-extension onetool-pi-*.tgz

# Watch otpi src and rebuild on change
watch-build:
    npx tsc --watch

# Watch otpi src and re-run tests on change
watch-test:
    nodemon --watch src --ext ts --exec "npm test"
