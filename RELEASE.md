# Release Guide

Use this checklist before every npm release.

## Pre-release

```bash
npm ci
npm run check:release
npm audit
npm publish --dry-run --cache ./.npm-cache
```

If your local npm cache is broken or root-owned, keep using the repository cache override:

```bash
npm publish --dry-run --cache ./.npm-cache
```

## Beta Publish

Publish beta releases with an explicit dist-tag:

```bash
npm publish --tag beta --access public --cache ./.npm-cache
```

Do not promote to `latest` until the current release has been validated on multiple real projects outside the repository fixtures.

## Post-publish Checks

Verify the package from a clean shell:

```bash
npx deskpack@beta --version
```

Then smoke-test the main flow on a throwaway supported app:

```bash
npx deskpack@beta init --yes --force
npx deskpack@beta build --skip-package
```
