# shipdesk

> Convert any full-stack JavaScript web app into a cross-platform desktop application.

**shipdesk** is an open-source CLI tool that takes your existing full-stack JS project (React/Vue/Svelte frontend + Express/Hono/Fastify backend) and wraps it into a native desktop app using Electron — with zero changes to your source code.

## Why?

Every existing tool (Nativefier, Pake, ToDesktop) only wraps a **URL** — none of them handle the **backend server**. If you have a full-stack app with an API server, you're on your own.

**shipdesk** fills this gap. It auto-detects your project structure, bundles your backend with esbuild, generates an Electron shell, and packages everything into a `.dmg`, `.exe`, or `.AppImage`.

## Quick Start

```bash
# Navigate to your full-stack JS project
cd my-fullstack-app

# Initialize — auto-detects your project
npx shipdesk init

# Run as a desktop app in dev mode
npx shipdesk dev

# Build a distributable installer
npx shipdesk build
```

## What It Detects

| Category | Supported |
|----------|-----------|
| **Monorepo** | pnpm workspaces, yarn workspaces, npm workspaces, Lerna, Nx, Turborepo |
| **Frontend** | Vite, Next.js (static export), Create React App, Webpack |
| **UI Library** | React, Vue, Svelte, Angular, Solid |
| **Backend** | Express, Hono, Fastify, Koa, NestJS |
| **Package Manager** | pnpm, yarn, npm |

## How It Works

```
┌──────────────────────────────────────────┐
│ Your project                             │
│  ├── frontend/ (React + Vite)            │
│  └── backend/  (Hono + Node.js)          │
└──────────────┬───────────────────────────┘
               │  npx shipdesk build
               ▼
┌──────────────────────────────────────────┐
│ Electron Desktop App                     │
│                                          │
│  Main Process (Node.js)                  │
│   └── Forks bundled server.cjs           │
│                                          │
│  Renderer (Chromium BrowserWindow)       │
│   └── Built frontend (static files)     │
│                                          │
│  Resources/                              │
│   ├── server.cjs  (esbuild bundle)       │
│   └── web-dist/   (Vite/Webpack output)  │
└──────────────────────────────────────────┘
```

## Commands

### `shipdesk init`

Scans your project, detects the frontend/backend/monorepo setup, and creates the desktop configuration:

- `shipdesk.config.json` — detected settings (editable)
- `.shipdesk/desktop/` — Electron shell files

### `shipdesk dev`

Starts your dev servers and opens an Electron window pointing at the Vite dev server. Hot-reload works as normal.

### `shipdesk build`

Builds a production distributable:

1. Builds your frontend (runs your existing build command)
2. Bundles your backend into a single `server.cjs` via esbuild
3. Generates the Electron main process
4. Packages everything with electron-builder

Output: `.shipdesk/release/` (`.dmg`, `.exe`, `.AppImage`)

## Configuration

After `shipdesk init`, a `shipdesk.config.json` is created. You can manually edit it:

```json
{
  "name": "My App",
  "appId": "com.myapp.app",
  "frontend": {
    "path": "apps/web",
    "framework": "vite",
    "buildCommand": "vite build",
    "distDir": "apps/web/dist",
    "devPort": 5173
  },
  "backend": {
    "path": "apps/api",
    "framework": "hono",
    "entry": "apps/api/src/index.ts",
    "devPort": 3000,
    "nativeDeps": ["playwright"]
  }
}
```

## Supported Platforms

| Platform | Installer Format |
|----------|-----------------|
| macOS | `.dmg`, `.zip` |
| Windows | `.exe` (NSIS) |
| Linux | `.AppImage`, `.deb` |

> **Note:** You can only build for your current OS. For cross-platform builds, use CI/CD (e.g., GitHub Actions).

## Requirements

- Node.js >= 18
- A full-stack JS project with a frontend and backend

## License

MIT
