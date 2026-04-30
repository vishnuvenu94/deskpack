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
  "@libsql/client",
  "libsql",
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

const ENTRY_EXTENSIONS = ["ts", "js", "mjs", "cjs"];
const ENTRY_FILE_PATTERN = /\.(?:ts|js|mjs|cjs)$/;
const SCRIPT_RUNNERS = new Set([
  "node",
  "tsx",
  "ts-node",
  "bun",
  "deno",
  "nodemon",
  "vite-node",
]);
const RUNNER_SUBCOMMANDS = new Set(["dev", "run", "serve", "start", "watch"]);
const OPTIONS_WITH_VALUES = new Set([
  "--config",
  "--env-file",
  "--import",
  "--inspect",
  "--inspect-brk",
  "--loader",
  "--require",
  "--watch-path",
  "--watch",
  "-c",
  "-e",
  "-I",
  "-r",
  "-w",
]);

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
  if (!entry) {
    throw new Error(
      `Could not detect a backend entry point for ${path.relative(process.cwd(), fullPath) || "."}. ` +
        `Detected ${framework} dependencies, but none of these files exist: ` +
        backendEntryCandidates(fullPath).map((candidate) => path.relative(fullPath, candidate)).join(", "),
    );
  }
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
): string | null {
  // 1. Explicit `main` field
  if (typeof pkg.main === "string" && entryFileExists(fullPath, pkg.main)) {
    return path.join(searchPath, pkg.main);
  }

  // 2. Parse scripts for a file path
  const scripts = pkg.scripts as Record<string, string> | undefined;
  const scriptText = [scripts?.start, scripts?.dev].filter(Boolean).join(" ");
  const scriptEntry = detectScriptEntry(fullPath, scriptText);
  if (scriptEntry) return path.join(searchPath, scriptEntry);

  // 3. Common file name conventions
  const framework = detectBackendFramework(pkg);
  for (const candidate of backendEntryCandidates(fullPath, undefined, framework)) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.join(searchPath, path.relative(fullPath, candidate));
    }
  }

  return null;
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
  entryAbsolutePath?: string,
  framework: BackendFramework = "unknown",
): string[] {
  const relativeCandidates = framework === "nestjs"
    ? nestBackendEntryCandidates()
    : standardBackendEntryCandidates();

  return [...new Set([
    ...(entryAbsolutePath ? [entryAbsolutePath] : []),
    ...relativeCandidates.map((candidate) => path.join(packageDir, candidate)),
  ])];
}

function detectBackendFramework(pkg: Record<string, unknown>): BackendFramework {
  const allDeps: Record<string, string> = {
    ...(isRecord(pkg.dependencies) ? pkg.dependencies : {}),
    ...(isRecord(pkg.devDependencies) ? pkg.devDependencies : {}),
  };

  for (const [dep, fw] of Object.entries(BACKEND_DEPS)) {
    if (dep in allDeps) return fw;
  }

  return "unknown";
}

function detectScriptEntry(packageDir: string, scriptText: string): string | null {
  if (!scriptText.trim()) return null;

  const tokens = tokenizeScript(scriptText);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = path.basename(tokens[index]);
    const normalizedRunner = token.replace(/\.(?:cmd|exe)$/i, "");

    if (normalizedRunner === "nest" && tokens[index + 1] === "start") {
      const nestEntry = findExistingRelativeCandidate(packageDir, nestBackendEntryCandidates());
      if (nestEntry) return nestEntry;
    }

    if (!SCRIPT_RUNNERS.has(normalizedRunner)) continue;

    const entry = findEntryAfterRunner(packageDir, tokens, index + 1);
    if (entry) return entry;
  }

  return null;
}

function findEntryAfterRunner(
  packageDir: string,
  tokens: string[],
  startIndex: number,
): string | null {
  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = normalizeScriptToken(tokens[index]);
    if (!token) continue;

    if (OPTIONS_WITH_VALUES.has(token)) {
      index += 1;
      continue;
    }

    if (token.startsWith("-")) continue;
    if (RUNNER_SUBCOMMANDS.has(token)) continue;

    if (isEntryFileToken(token) && entryFileExists(packageDir, token)) {
      return normalizeRelativePath(token);
    }
  }

  return null;
}

function tokenizeScript(scriptText: string): string[] {
  const tokens: string[] = [];
  let current = "";

  for (let index = 0; index < scriptText.length; index += 1) {
    const char = scriptText[index];

    if (char === "\"" || char === "'") {
      index = readQuotedScript(scriptText, index + 1, char, tokens);
      current = "";
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    if (";&|()".includes(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) tokens.push(current);
  return tokens.map(normalizeScriptToken).filter(Boolean);
}

function readQuotedScript(
  scriptText: string,
  startIndex: number,
  quote: string,
  tokens: string[],
): number {
  let quoted = "";
  let index = startIndex;

  for (; index < scriptText.length; index += 1) {
    if (scriptText[index] === quote) break;
    quoted += scriptText[index];
  }

  tokens.push(...tokenizeScript(quoted));
  return index;
}

function normalizeScriptToken(token: string): string {
  return token
    .trim()
    .replace(/^cross-env$/, "")
    .replace(/^env$/, "")
    .replace(/^['"]|['"]$/g, "")
    .replace(/,$/, "");
}

function isEntryFileToken(token: string): boolean {
  if (/^(?:https?:|npm:|jsr:)/.test(token)) return false;
  if (!ENTRY_FILE_PATTERN.test(token)) return false;
  return !/\.(?:tsx|jsx)$/.test(token);
}

function entryFileExists(packageDir: string, relativePath: string): boolean {
  const candidate = path.resolve(packageDir, normalizeRelativePath(relativePath));
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
}

function findExistingRelativeCandidate(
  packageDir: string,
  relativeCandidates: string[],
): string | null {
  for (const candidate of relativeCandidates) {
    if (entryFileExists(packageDir, candidate)) return candidate;
  }

  return null;
}

function standardBackendEntryCandidates(): string[] {
  return entryCandidateMatrix([
    "server",
    "src",
    "backend/src",
    "backend",
    "api",
    ".",
    "dist",
    "build",
  ], [
    "index",
    "server",
    "main",
    "app",
  ]);
}

function nestBackendEntryCandidates(): string[] {
  return [
    ...entryCandidateMatrix(["src"], ["main", "index", "server", "app"]),
    ...entryCandidateMatrix(["dist", "build"], ["main", "index", "server", "app"]),
    ...standardBackendEntryCandidates(),
  ];
}

function entryCandidateMatrix(dirs: string[], names: string[]): string[] {
  const candidates: string[] = [];

  for (const dir of dirs) {
    for (const name of names) {
      for (const extension of ENTRY_EXTENSIONS) {
        candidates.push(dir === "." ? `${name}.${extension}` : path.join(dir, `${name}.${extension}`));
      }
    }
  }

  return candidates;
}

function normalizeRelativePath(value: string): string {
  return value.replace(/^\.?\//, "").split(/[\\/]/).join(path.sep);
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

function isRecord(value: unknown): value is Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
