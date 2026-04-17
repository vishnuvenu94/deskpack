import fs from "node:fs";
import path from "node:path";
import type { BackendInfo, BackendFramework } from "../types.js";

/** Maps dependency names to backend framework identifiers. */
const BACKEND_DEPS: Record<string, BackendFramework> = {
  "express": "express",
  "hono": "hono",
  "@hono/node-server": "hono",
  "fastify": "fastify",
  "koa": "koa",
  "@nestjs/core": "nestjs",
};

/** Well-known native Node.js modules that cannot be bundled by esbuild. */
const KNOWN_NATIVE_DEPS: string[] = [
  "playwright",
  "playwright-core",
  "better-sqlite3",
  "sqlite3",
  "sharp",
  "bcrypt",
  "canvas",
  "node-pty",
  "fsevents",
  "cpu-features",
  "ssh2",
  "node-gyp",
];

/**
 * Attempt to detect a Node.js backend server in the given path.
 *
 * @param rootDir  Absolute path to the project root.
 * @param searchPath  Relative path to the package to inspect.
 * @returns Detected info, or `null` if this is not a backend package.
 */
export function detectBackend(
  rootDir: string,
  searchPath: string,
): BackendInfo | null {
  const fullPath = path.resolve(rootDir, searchPath);
  const pkgJsonPath = path.join(fullPath, "package.json");
  if (!fs.existsSync(pkgJsonPath)) return null;

  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
  const allDeps: Record<string, string> = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  // --- Framework -----------------------------------------------------------
  let framework: BackendFramework = "unknown";
  for (const [dep, fw] of Object.entries(BACKEND_DEPS)) {
    if (dep in allDeps) {
      framework = fw;
      break;
    }
  }

  if (framework === "unknown") return null;

  // --- Entry point ---------------------------------------------------------
  const entry = detectEntryPoint(fullPath, searchPath, pkg);

  // --- Port ----------------------------------------------------------------
  const devPort = detectServerPort(fullPath, pkg);

  // --- Native dependencies -------------------------------------------------
  const nativeDeps = collectNativeDeps(allDeps);

  // --- Dev command ---------------------------------------------------------
  const devCommand: string = pkg.scripts?.dev ?? pkg.scripts?.start ?? "";

  return { framework, path: searchPath, entry, devCommand, devPort, nativeDeps };
}

/**
 * Quick predicate — returns `true` if the package looks like a backend.
 */
export function isBackendPackage(
  rootDir: string,
  packagePath: string,
): boolean {
  const pkgJsonPath = path.join(rootDir, packagePath, "package.json");
  if (!fs.existsSync(pkgJsonPath)) return false;

  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
  const allDeps: Record<string, string> = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  return Object.keys(BACKEND_DEPS).some((dep) => dep in allDeps);
}

/**
 * Collect native deps recursively from workspace packages, following
 * workspace:* dependency chain.
 */
export function collectNativeDepsFromWorkspaces(
  rootDir: string,
  workspaces: string[],
): string[] {
  const all = new Set<string>();
  const workspaceSet = new Set(workspaces);

  function collectRecursive(wsPath: string, visited: Set<string>): void {
    if (visited.has(wsPath)) return;
    visited.add(wsPath);

    const pkgPath = path.join(rootDir, wsPath, "package.json");
    if (!fs.existsSync(pkgPath)) return;

    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const deps: Record<string, string> = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    for (const dep of collectNativeDeps(deps)) {
      all.add(dep);
    }

    for (const [depName, depVersion] of Object.entries(deps)) {
      if (
        depVersion.startsWith("workspace:") ||
        depVersion === "*" ||
        depVersion === ""
      ) {
        const shortName = depName.replace(/^@[^/]+\//, "");
        if (workspaceSet.has(depName)) {
          collectRecursive(depName, visited);
        } else if (workspaceSet.has(shortName)) {
          collectRecursive(shortName, visited);
        }
      }
    }
  }

  for (const ws of workspaces) {
    collectRecursive(ws, new Set());
  }

  return [...all];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectEntryPoint(
  fullPath: string,
  searchPath: string,
  pkg: Record<string, unknown>,
): string {
  // 1. Explicit `main` field
  if (typeof pkg.main === "string") {
    return path.join(searchPath, pkg.main);
  }

  // 2. Parse scripts for a file path
  const scripts = pkg.scripts as Record<string, string> | undefined;
  const scriptText = [scripts?.start, scripts?.dev].filter(Boolean).join(" ");

  const patterns = [
    /(?:tsx?|ts-node|node)\s+(?:--[^\s]+\s+)*([^\s]+\.(?:ts|js|mjs))/,
    /nodemon\s+(?:--[^\s]+\s+)*([^\s]+\.(?:ts|js|mjs))/,
  ];

  for (const pattern of patterns) {
    const match = scriptText.match(pattern);
    if (match) return path.join(searchPath, match[1]);
  }

  // 3. Common file name conventions
  const candidates = [
    "src/index.ts",
    "src/index.js",
    "src/server.ts",
    "src/server.js",
    "src/app.ts",
    "src/app.js",
    "src/main.ts",
    "src/main.js",
    "index.ts",
    "index.js",
    "server.ts",
    "server.js",
    "app.ts",
    "app.js",
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(fullPath, candidate))) {
      return path.join(searchPath, candidate);
    }
  }

  return path.join(searchPath, "src/index.ts");
}

function detectServerPort(
  fullPath: string,
  pkg: Record<string, unknown>,
): number {
  // Check scripts for PORT env
  const scripts = pkg.scripts as Record<string, string> | undefined;
  const scriptText = [scripts?.start, scripts?.dev].filter(Boolean).join(" ");
  const portMatch = scriptText.match(/PORT\s*[=:]\s*(\d+)/);
  if (portMatch) return parseInt(portMatch[1], 10);

  // Check source files for port declarations
  const candidates = [
    "src/index.ts",
    "src/index.js",
    "src/server.ts",
    "src/server.js",
    "index.ts",
    "index.js",
  ];

  for (const candidate of candidates) {
    const filePath = path.join(fullPath, candidate);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      const match = content.match(
        /(?:port|PORT)\s*(?:=|:|\?\?)\s*["']?(\d{3,5})["']?/,
      );
      if (match) return parseInt(match[1], 10);
    }
  }

  return 3000;
}

function collectNativeDeps(deps: Record<string, string>): string[] {
  return KNOWN_NATIVE_DEPS.filter((dep) => dep in deps);
}
