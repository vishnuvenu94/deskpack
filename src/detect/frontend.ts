import fs from "node:fs";
import path from "node:path";
import type { FrontendInfo, FrontendFramework, UILibrary } from "../types.js";

/** Maps dependency names to UI library identifiers. */
const UI_LIBRARY_DEPS: Record<string, UILibrary> = {
  "react": "react",
  "react-dom": "react",
  "vue": "vue",
  "svelte": "svelte",
  "@angular/core": "angular",
  "solid-js": "solid",
};

/** Maps config filenames to build tool identifiers. */
const BUILD_TOOL_CONFIGS: Record<string, FrontendFramework> = {
  "vite.config.ts": "vite",
  "vite.config.js": "vite",
  "vite.config.mts": "vite",
  "vite.config.mjs": "vite",
  ".parcelrc": "parcel",
  "next.config.ts": "next",
  "next.config.js": "next",
  "next.config.mjs": "next",
  "next.config.cjs": "next",
  "webpack.config.ts": "webpack",
  "webpack.config.js": "webpack",
  "webpack.config.mjs": "webpack",
};

/**
 * Attempt to detect a frontend framework in the given path.
 *
 * @param rootDir  Absolute path to the project root.
 * @param searchPath  Relative path to the package to inspect.
 * @returns Detected info, or `null` if this is not a frontend package.
 */
export function detectFrontend(
  rootDir: string,
  searchPath: string,
): FrontendInfo | null {
  const fullPath = path.resolve(rootDir, searchPath);
  const pkgJsonPath = path.join(fullPath, "package.json");
  if (!fs.existsSync(pkgJsonPath)) return null;

  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
  const allDeps: Record<string, string> = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  // --- UI library ----------------------------------------------------------
  let uiLibrary: UILibrary = "unknown";
  for (const [dep, lib] of Object.entries(UI_LIBRARY_DEPS)) {
    if (dep in allDeps) {
      uiLibrary = lib;
      break;
    }
  }

  if (uiLibrary === "unknown" && !("react-scripts" in allDeps)) return null;

  // --- Build tool ----------------------------------------------------------
  let framework: FrontendFramework = "unknown";

  if ("react-scripts" in allDeps) {
    framework = "cra";
  } else {
    for (const [configFile, tool] of Object.entries(BUILD_TOOL_CONFIGS)) {
      if (fs.existsSync(path.join(fullPath, configFile))) {
        framework = tool;
        break;
      }
    }

    if (framework === "unknown") {
      if ("next" in allDeps) framework = "next";
      else if ("vite" in allDeps) framework = "vite";
      else if ("webpack" in allDeps) framework = "webpack";
      else if ("parcel" in allDeps || "@parcel/core" in allDeps) framework = "parcel";
    }
  }

  // --- Build command -------------------------------------------------------
  const buildCommand = determineBuildCommand(pkg, framework);

  // --- Dev port ------------------------------------------------------------
  const devPort = detectDevPort(fullPath, framework);

  // --- Dev command ---------------------------------------------------------
  const devCommand: string = pkg.scripts?.dev ?? pkg.scripts?.start ?? "";

  // --- Dist directory ------------------------------------------------------
  const distDir = determineDistDir(searchPath, framework);

  return {
    framework,
    uiLibrary,
    path: searchPath,
    buildCommand,
    devCommand,
    devPort,
    distDir,
  };
}

/**
 * Quick predicate — returns `true` if the package looks like a frontend.
 */
export function isFrontendPackage(
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

  for (const dep of Object.keys(UI_LIBRARY_DEPS)) {
    if (dep in allDeps) return true;
  }

  const buildPluginIndicators = [
    "react-scripts",
    "@vitejs/plugin-react",
    "@vitejs/plugin-vue",
    "@sveltejs/vite-plugin-svelte",
  ];

  return buildPluginIndicators.some((d) => d in allDeps);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function determineBuildCommand(
  pkg: Record<string, unknown>,
  framework: FrontendFramework,
): string {
  const scripts = pkg.scripts as Record<string, string> | undefined;
  if (scripts?.build) return scripts.build;

  switch (framework) {
    case "vite":
      return "vite build";
    case "next":
      return "next build";
    case "cra":
      return "react-scripts build";
    case "webpack":
      return "webpack --mode production";
    case "parcel":
      return "parcel build";
    default:
      return "";
  }
}

function detectDevPort(
  fullPath: string,
  framework: FrontendFramework,
): number {
  if (framework === "vite") {
    for (const name of ["vite.config.ts", "vite.config.js", "vite.config.mts"]) {
      const configPath = path.join(fullPath, name);
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, "utf-8");
        const match = content.match(/port\s*:\s*(\d+)/);
        if (match) return parseInt(match[1], 10);
      }
    }
    return 5173;
  }

  if (framework === "next" || framework === "cra") return 3000;
  if (framework === "parcel") return 1234;
  return 5173;
}

/**
 * Detect API proxy prefixes from Vite config (and other dev proxy configs).
 * Returns an array of URL path prefixes like ["/api"] that the frontend
 * proxies to the backend during development.
 */
export function detectApiPrefixes(rootDir: string, searchPath: string): string[] {
  const fullPath = path.resolve(rootDir, searchPath);
  const prefixes = new Set<string>();

  const viteConfigCandidates = [
    "vite.config.ts",
    "vite.config.js",
    "vite.config.mts",
    "vite.config.mjs",
  ];

  for (const configName of viteConfigCandidates) {
    const configPath = path.join(fullPath, configName);
    if (!fs.existsSync(configPath)) continue;

    const content = fs.readFileSync(configPath, "utf-8");
    const proxyBlock = content;

    const proxyKeyRegex = /["']\s*(\/[a-zA-Z][a-zA-Z0-9_/-]*)\s*["']\s*:/g;
    let insideProxy = false;
    let braceDepth = 0;

    for (const line of proxyBlock.split("\n")) {
      const trimmed = line.trim();

      if (/\bproxy\s*:/.test(trimmed)) {
        insideProxy = true;
      }

      if (insideProxy) {
        braceDepth += (trimmed.match(/\{/g) || []).length;
        braceDepth -= (trimmed.match(/\}/g) || []).length;

        const match = proxyKeyRegex.exec(trimmed);
        if (match) {
          prefixes.add(match[1]);
        }

        if (braceDepth <= 0 && /\}/.test(trimmed)) {
          insideProxy = false;
          braceDepth = 0;
          break;
        }
      }
    }

    if (prefixes.size > 0) break;
  }

  if (prefixes.size === 0) {
    return ["/api"];
  }

  return [...prefixes];
}

function determineDistDir(
  searchPath: string,
  framework: FrontendFramework,
): string {
  const base = searchPath === "." ? "" : searchPath;

  switch (framework) {
    case "vite":
      return path.join(base, "dist");
    case "next":
      return path.join(base, "out");
    case "cra":
      return path.join(base, "build");
    case "webpack":
      return path.join(base, "dist");
    case "parcel":
      return path.join(base, "dist");
    default:
      return path.join(base, "dist");
  }
}
