import fs from "node:fs";
import path from "node:path";
import type { FrontendInfo, NextRuntimeInfo } from "../types.js";
import { findStandaloneServerJsFile } from "../next-standalone-server.js";

const NEXT_CONFIG_NAMES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.cjs",
  "next.config.ts",
] as const;

/**
 * Inspect Next.js config for the runtime output mode deskpack can package.
 */
export function analyzeNextRuntime(
  rootDir: string,
  frontend: FrontendInfo,
): NextRuntimeInfo | undefined {
  if (frontend.framework !== "next") return undefined;

  const frontendDir = path.join(rootDir, frontend.path);
  const relativeBase = frontend.path === "." ? "" : frontend.path;
  const standaloneDir = path.join(relativeBase, ".next", "standalone");
  const serverFile = resolveStandaloneServerFileRelative(rootDir, relativeBase, standaloneDir);
  const staticDir = path.join(relativeBase, ".next", "static");
  const publicDir = path.join(relativeBase, "public");

  if (isNextStaticExport(rootDir, frontend.path)) {
    return {
      mode: "static-export",
      standaloneDir,
      serverFile,
      staticDir,
      publicDir,
      warnings: [],
    };
  }

  if (isNextStandaloneOutput(rootDir, frontend.path)) {
    return {
      mode: "standalone",
      standaloneDir,
      serverFile,
      staticDir,
      publicDir,
      warnings: [],
    };
  }

  return {
    mode: "unsupported",
    standaloneDir,
    serverFile,
    staticDir,
    publicDir,
    warnings: [
      'Next.js server runtime detected without output: "standalone". Add output: "standalone" to next.config.* for desktop SSR packaging.',
    ],
  };
}

export function isNextStaticExport(rootDir: string, frontendPath: string): boolean {
  const frontendDir = path.join(rootDir, frontendPath);

  for (const configPath of nextConfigPaths(frontendDir)) {
    const content = fs.readFileSync(configPath, "utf-8");
    if (/output\s*:\s*["']export["']/.test(content)) {
      return true;
    }
  }

  const packageJsonPath = path.join(frontendDir, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
      scripts?: Record<string, string>;
    };
    const buildScript = pkg.scripts?.build ?? "";
    if (/\bnext\s+export\b/.test(buildScript)) {
      return true;
    }
  }

  return false;
}

export function isNextStandaloneOutput(rootDir: string, frontendPath: string): boolean {
  const frontendDir = path.join(rootDir, frontendPath);

  for (const configPath of nextConfigPaths(frontendDir)) {
    const content = fs.readFileSync(configPath, "utf-8");
    if (/output\s*:\s*["']standalone["']/.test(content)) {
      return true;
    }
  }

  return false;
}

function nextConfigPaths(frontendDir: string): string[] {
  const result: string[] = [];
  for (const name of NEXT_CONFIG_NAMES) {
    const configPath = path.join(frontendDir, name);
    if (fs.existsSync(configPath)) result.push(configPath);
  }
  return result;
}

/**
 * Prefer `.next/standalone/server.js`; if missing, use nested
 * `.next/standalone/<project>/server.js` when present (Next 13+ layout).
 */
function resolveStandaloneServerFileRelative(
  rootDir: string,
  relativeBase: string,
  standaloneDir: string,
): string {
  const standaloneAbs = path.resolve(rootDir, relativeBase || ".", ".next", "standalone");
  const found = findStandaloneServerJsFile(standaloneAbs);
  if (found) {
    return path.relative(rootDir, found);
  }
  return path.join(standaloneDir, "server.js");
}
