# Contributing

Thanks for helping improve deskpack.

## Development

1. Install dependencies:

```bash
npm ci
```

2. Run checks:

```bash
npm run check:naming
npm run lint
npm run test
```

3. Run release checklist locally before publishing:

```bash
npm run check:release
```

4. Run the full publish checklist when preparing an npm release:

```bash
npm run check:publish
```

Release steps and beta publishing notes live in `RELEASE.md`.

## Pull Requests

- Keep changes focused and include tests for behavior changes.
- Do not introduce old project naming in source or docs.
- Use clear commit messages describing user-facing impact.
- Add or update fixtures in `test/fixtures/` when changing framework detection, topology handling, or packaging behavior.
- Include the smallest realistic repro fixture you can when adding support for a new app shape.

## Scope

Current beta scope is intentionally narrow:

- Frontend static apps
- Full-stack Node backends with static frontend or separate static frontend + API backend
- Next.js static export only (`output: "export"`)
- TanStack Start static/prerender output only
