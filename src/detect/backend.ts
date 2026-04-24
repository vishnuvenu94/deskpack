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
  const entryAbsolutePath = path.resolve(rootDir, entry);

  // --- Port ----------------------------------------------------------------
  const devPort = detectServerPort(fullPath, pkg, entryAbsolutePath);

  // --- Native dependencies -------------------------------------------------
  const nativeDeps = collectNativeDeps(allDeps);
  const healthCheckPath = detectHealthCheckPath(fullPath, entryAbsolutePath);

  // --- Dev command ---------------------------------------------------------
  const devCommand: string = pkg.scripts?.dev ?? pkg.scripts?.start ?? "";

  return {
    framework,
    path: searchPath,
    entry,
    devCommand,
    devPort,
    nativeDeps,
    healthCheckPath,
  };
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
  entryAbsolutePath: string,
): number {
  // Check scripts for PORT env
  const scripts = pkg.scripts as Record<string, string> | undefined;
  const scriptText = [scripts?.start, scripts?.dev].filter(Boolean).join(" ");
  const portMatch = scriptText.match(/PORT\s*[=:]\s*(\d+)/);
  if (portMatch) return parseInt(portMatch[1], 10);

  for (const filePath of backendEntryCandidates(fullPath, entryAbsolutePath)) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue;

    const detectedPort = detectPortFromContent(fs.readFileSync(filePath, "utf-8"));
    if (detectedPort) return detectedPort;
  }

  return 3000;
}

function collectNativeDeps(deps: Record<string, string>): string[] {
  return KNOWN_NATIVE_DEPS.filter((dep) => dep in deps);
}

function detectHealthCheckPath(
  packageDir: string,
  entryAbsolutePath: string,
): string {
  const healthPathRegexes: RegExp[] = [
    /\.(?:get|post|all|use)\s*\(\s*["'`](\/(?:healthz?|ready|status)[^"'`]*)["'`]/,
    /app\s*\.\s*get\s*\(\s*["'`](\/[^"'`]*health[^"'`]*)["'`]/,
    /fastify\s*\.\s*get\s*\(\s*["'`](\/[^"'`]*health[^"'`]*)["'`]/,
    /router\s*\.\s*get\s*\(\s*["'`](\/[^"'`]*health[^"'`]*)["'`]/,
  ];

  for (const filePath of collectCodeFiles(packageDir, entryAbsolutePath)) {
    const content = fs.readFileSync(filePath, "utf-8");

    for (const regex of healthPathRegexes) {
      const match = content.match(regex);
      if (match?.[1]) {
        const normalized = normalizeHealthPath(match[1]);
        if (normalized) return normalized;
      }
    }

    const nestHealthPath = detectNestHealthPath(content);
    if (nestHealthPath) return nestHealthPath;
  }

  return "/";
}

function backendEntryCandidates(
  packageDir: string,
  entryAbsolutePath: string,
): string[] {
  return [...new Set([
    entryAbsolutePath,
    path.join(packageDir, "src/index.ts"),
    path.join(packageDir, "src/index.js"),
    path.join(packageDir, "src/server.ts"),
    path.join(packageDir, "src/server.js"),
    path.join(packageDir, "src/main.ts"),
    path.join(packageDir, "src/main.js"),
    path.join(packageDir, "index.ts"),
    path.join(packageDir, "index.js"),
    path.join(packageDir, "server.ts"),
    path.join(packageDir, "server.js"),
    path.join(packageDir, "main.ts"),
    path.join(packageDir, "main.js"),
  ])];
}

function detectPortFromContent(content: string): number | null {
  const patterns = [
    /\bPORT\s*[=:]\s*(\d{3,5})\b/,
    /process\.env\.PORT\s*(?:\|\||\?\?)\s*(\d{3,5})\b/,
    /\.\s*listen\s*\(\s*(\d{3,5})\b/,
    /\b(?:const|let|var)\s+\w*port\w*\s*=\s*(\d{3,5})\b/i,
    /(?:port|PORT)\s*(?:=|:|\?\?)\s*["'`]?(\d{3,5})["'`]?/,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.[1]) {
      return parseInt(match[1], 10);
    }
  }

  return null;
}

function collectCodeFiles(
  packageDir: string,
  entryAbsolutePath: string,
): string[] {
  const files = new Set<string>();

  for (const candidate of backendEntryCandidates(packageDir, entryAbsolutePath)) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      files.add(candidate);
    }
  }

  const visit = (dirPath: string): void => {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return;

    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (["node_modules", "dist", "build", "coverage"].includes(entry.name)) continue;
        visit(path.join(dirPath, entry.name));
        continue;
      }

      if (!entry.isFile()) continue;
      if (!/\.(ts|js|mjs|cjs|tsx|jsx)$/.test(entry.name)) continue;
      files.add(path.join(dirPath, entry.name));
    }
  };

  visit(packageDir);
  return [...files];
}

function detectNestHealthPath(content: string): string | null {
  const controllerMatch = content.match(
    /@Controller\s*\(\s*(?:["'`](\/?[^"'`]*)["'`])?\s*\)/,
  );
  const controllerPrefix = normalizeRouteSegment(controllerMatch?.[1] ?? "");

  const controllerLooksLikeHealth = containsHealthKeyword(controllerPrefix);
  const routeRegex =
    /@(?:Get|Head|All)\s*\(\s*(?:["'`](\/?[^"'`]*)["'`])?\s*\)/g;

  for (const match of content.matchAll(routeRegex)) {
    const methodPath = normalizeRouteSegment(match[1] ?? "");
    const combined = [controllerPrefix, methodPath].filter(Boolean).join("/");

    if (!containsHealthKeyword(combined) && !(controllerLooksLikeHealth && methodPath.length === 0)) {
      continue;
    }

    if (combined.length > 0) {
      return normalizeHealthPath(`/${combined}`);
    }

    return "/";
  }

  return null;
}

function normalizeHealthPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return null;

  const withoutQuery = trimmed.split("?")[0].split("#")[0].trim();
  if (withoutQuery.length === 0) return null;

  return withoutQuery;
}

function normalizeRouteSegment(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function containsHealthKeyword(value: string): boolean {
  return /(healthz?|ready|status)/i.test(value);
}
