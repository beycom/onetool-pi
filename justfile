default: install typecheck test

install:
    npm install

test:
    npm run test

test-e2e:
    npm run test:e2e

typecheck:
    npm run typecheck

publish:
    npm publish

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
