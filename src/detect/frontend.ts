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
  "next.config.ts": "next",
  "next.config.js": "next",
  "next.config.mjs": "next",
  "webpack.config.ts": "webpack",
  "webpack.config.js": "webpack",
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
  return 5173;
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
    default:
      return path.join(base, "dist");
  }
}
