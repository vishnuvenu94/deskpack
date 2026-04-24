# deskpack

> Package JavaScript frontend and full-stack Node apps into desktop applications.

`deskpack` detects your project topology, bundles what is needed for runtime, generates an Electron shell, and packages installers for supported targets.

## Beta Scope

- Frontend-only static apps
- Full-stack Node backends where:
  - backend serves frontend static files, or
  - frontend is static and served separately from an API backend
- Next.js static export (`output: "export"`) only
- Next.js SSR/server runtime is rejected early

## Quick Start

```bash
cd my-js-project
npx deskpack init
npx deskpack dev
npx deskpack build
```

### Non-interactive init

```bash
npx deskpack init --yes --name "My App" --app-id com.example.myapp --force
```

## Commands

### `deskpack init`

Detects structure and creates:

- `deskpack.config.json`
- `.deskpack/desktop/main.cjs`
- `.deskpack/desktop/electron-builder.yml`
- `.deskpack/desktop/package.json`

Flags:

- `--yes`
- `--name <name>`
- `--app-id <app-id>`
- `--force`

### `deskpack dev`

- Starts missing dev servers when needed
- Keeps backend on its configured port and only falls back for the frontend dev server
- Regenerates runtime launcher with selected dev ports
- Launches Electron against your running frontend dev server

### `deskpack build`

```bash
npx deskpack build
npx deskpack build --skip-package
npx deskpack build --platform mac
npx deskpack build --platform windows
npx deskpack build --platform linux
```

Build flow:

1. Build frontend
2. Bundle backend (when present)
3. Copy runtime dependencies (native deps remain external)
4. Regenerate Electron main process
5. Package (unless `--skip-package`)

Output directory:

- `.deskpack/release/`

## Supported Detection

### Frontend frameworks

- Vite
- Next.js (static export only)
- Angular CLI
- Create React App
- Webpack
- Parcel (basic detection)

### UI libraries

- React
- Vue
- Svelte
- Angular
- Solid

### Backend frameworks

- Express
- Hono
- Fastify
- Koa
- NestJS

### Monorepo/workspace support

- pnpm workspaces
- yarn workspaces
- npm workspaces
- Lerna
- Nx
- Turborepo (workspace metadata only)

## Platform Policy

`deskpack` uses a conservative packaging policy and fails fast with explicit reasons when cross-building is not reliable.

- Same-OS packaging: allowed
- Windows cross-build: only when no native runtime deps are detected and Wine is available
- macOS installers: build on macOS
- Linux installers: build on Linux

## Configuration

`deskpack.config.json` is generated and can be edited:

```json
{
  "name": "My App",
  "appId": "com.example.myapp",
  "frontend": {
    "path": "frontend",
    "framework": "vite",
    "buildCommand": "vite build",
    "distDir": "frontend/dist",
    "devPort": 4173
  },
  "backend": {
    "path": "backend",
    "framework": "express",
    "entry": "backend/src/index.ts",
    "devPort": 3300,
    "healthCheckPath": "/health",
    "nativeDeps": []
  }
}
```

## Requirements

- Node.js >= 18
- JavaScript project with a supported frontend topology

## License

MIT
