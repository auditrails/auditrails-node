# Publishing to npm

One-time setup:

1. Create (or use) an npm account/organization named `auditrails` so it owns
   the `@auditrails` scope — the package name is `@auditrails/node`.
2. Generate an **Automation** access token (npmjs.com → your avatar →
   Access Tokens → Generate New Token → Automation) with publish rights on
   that scope.
3. Add it as a repo secret: `gh secret set NPM_TOKEN --repo auditrails/auditrails-node`.

Releasing a new version:

```bash
npm version <new-version>   # bumps package.json, commits, tags locally
git push && git push --tags
```

Pushing a `v*` tag runs `.github/workflows/publish.yml`, which builds, tests,
and runs `npm publish --access public` using `NPM_TOKEN`. The workflow fails
closed if the tag doesn't match `package.json`'s version.
