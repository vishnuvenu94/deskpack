import fs from "node:fs";
import path from "node:path";
import type { FrontendInfo, TanstackStartInfo } from "../types.js";

const START_PACKAGE_NAMES = ["@tanstack/react-start", "@tanstack/solid-start"] as const;

const VITE_CONFIG_NAMES = [
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mts",
  "vite.config.mjs",
] as const;

const TANSTACK_PLUGIN_CALL =
  /\b(?:tanstackStart|tanstackReactStart|tanstackSolidStart)\s*\(/;

const NO_STATIC_MODE_MESSAGE =
  "TanStack Start server runtime detected. Enable SPA/static prerendering in tanstackStart() " +
  "(spa: { enabled: true } or prerender: { enabled: true }) or wait for SSR support.";

/**
 * When Start is confirmed, determine static-only eligibility and reasons to reject.
 */
export function analyzeTanstackStart(
  rootDir: string,
  frontend: FrontendInfo,
): TanstackStartInfo | undefined {
  const pkgDir = path.resolve(rootDir, frontend.path);
  const pkgJsonPath = path.join(pkgDir, "package.json");
  if (!fs.existsSync(pkgJsonPath)) return undefined;

  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps: Record<string, string> = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  const hasStartDep = START_PACKAGE_NAMES.some((name) => name in deps);
  if (!hasStartDep) return undefined;

  const viteFile = findFirstExisting(path.join(pkgDir), VITE_CONFIG_NAMES);
  if (!viteFile) return undefined;

  const viteContent = fs.readFileSync(viteFile, "utf-8");
  if (!TANSTACK_PLUGIN_CALL.test(viteContent)) return undefined;

  const spaEnabled = hasNestedEnabledFlag(viteContent, "spa");
  const prerenderEnabled = hasNestedEnabledFlag(viteContent, "prerender");
  const hasStaticMode = spaEnabled || prerenderEnabled;

  if (!hasStaticMode) {
    return {
      isConfirmed: true,
      spaEnabled: false,
      prerenderEnabled: false,
      ineligibilityReasons: [NO_STATIC_MODE_MESSAGE],
    };
  }

  const ineligibilityReasons = collectRuntimeBlockers(pkgDir, rootDir);
  return {
    isConfirmed: true,
    spaEnabled,
    prerenderEnabled,
    ineligibilityReasons,
  };
}

function findFirstExisting(dir: string, names: readonly string[]): string | null {
  for (const name of names) {
    const full = path.join(dir, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function hasNestedEnabledFlag(source: string, key: string): boolean {
  const re = new RegExp(
    `\\b${key}\\s*:\\s*\\{[\\s\\S]{0,2000}?\\benabled\\s*:\\s*true\\b`,
    "m",
  );
  return re.test(source);
}

function collectRuntimeBlockers(frontendAbs: string, rootDir: string): string[] {
  const handlerFiles: string[] = [];
  const serverFnFiles: string[] = [];
  const apiRouteFiles: string[] = [];

  walkSourceFiles(frontendAbs, (file) => {
    const rel = path.relative(rootDir, file);
    const content = fs.readFileSync(file, "utf-8");

    const hasHandlers = hasStartServerHandlers(content);
    const hasServerBlock = /\bserver\s*:\s*\{/.test(content);
    const blockingServerFn = hasBlockingCreateServerFn(content);

    if (hasHandlers) {
      handlerFiles.push(rel);
    }

    if (blockingServerFn) {
      serverFnFiles.push(rel);
    }

    if (isApiStyleRoutePath(file) && hasServerBlock && !hasHandlers && !blockingServerFn) {
      apiRouteFiles.push(rel);
    }
  });

  const messages: string[] = [];

  if (handlerFiles.length > 0) {
    messages.push(
      "TanStack Start server route handlers (server.handlers) require a runtime server, which deskpack does not bundle yet. " +
        `Found in: ${formatFileList(handlerFiles)}`,
    );
  }

  if (serverFnFiles.length > 0) {
    messages.push(
      "Non-static createServerFn(...) usage requires a TanStack Start server runtime. " +
        "Use createServerFn({ type: 'static' }) or @tanstack/start-static-server-functions, or remove server functions. " +
        `Found in: ${formatFileList(serverFnFiles)}`,
    );
  }

  if (apiRouteFiles.length > 0) {
    messages.push(
      "/api-style routes with a server block are treated as runtime-only unless proven static. " +
        `Found in: ${formatFileList(apiRouteFiles)}`,
    );
  }

  return messages;
}

function formatFileList(files: string[]): string {
  const max = 4;
  const head = files.slice(0, max);
  const extra = files.length > max ? ` (+${files.length - max} more)` : "";
  return head.join(", ") + extra;
}

function hasStartServerHandlers(content: string): boolean {
  if (!content.includes("server")) return false;
  return /\bserver\s*:\s*\{[\s\S]{0,4000}?\bhandlers\s*:/m.test(content);
}

function hasBlockingCreateServerFn(content: string): boolean {
  if (/@tanstack\/start-static-server-functions/.test(content)) {
    return false;
  }

  const re = /\bcreateServerFn\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const slice = content.slice(match.index, match.index + 600);
    if (!/\btype\s*:\s*["']static["']/.test(slice)) {
      return true;
    }
  }

  return false;
}

function isApiStyleRoutePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments.some((s) => s === "api" || /^api\./.test(s));
}

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  ".deskpack",
  "out",
]);

function walkSourceFiles(rootDir: string, onFile: (abs: string) => void): void {
  if (!fs.existsSync(rootDir)) return;

  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name)) continue;
        stack.push(full);
      } else if (entry.isFile()) {
        if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
          onFile(full);
        }
      }
    }
  }
}
