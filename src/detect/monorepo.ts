import fs from "node:fs";
import path from "node:path";
import type { MonorepoInfo, PackageManager, MonorepoType } from "../types.js";

/**
 * Detect monorepo tooling, package manager, and workspace package paths.
 */
export function detectMonorepo(rootDir: string): MonorepoInfo {
  const packageManager = detectPackageManager(rootDir);

  // pnpm workspaces ---------------------------------------------------------
  const pnpmWorkspacePath = path.join(rootDir, "pnpm-workspace.yaml");
  if (fs.existsSync(pnpmWorkspacePath)) {
    const content = fs.readFileSync(pnpmWorkspacePath, "utf-8");
    const globs = parseWorkspaceGlobs(content);
    return {
      type: "pnpm",
      packageManager: "pnpm",
      workspaces: resolveWorkspaces(rootDir, globs),
    };
  }

  // yarn / npm workspaces (package.json) ------------------------------------
  const pkgJsonPath = path.join(rootDir, "package.json");
  if (fs.existsSync(pkgJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
    if (pkg.workspaces) {
      const globs: string[] = Array.isArray(pkg.workspaces)
        ? pkg.workspaces
        : (pkg.workspaces.packages ?? []);
      const type: MonorepoType = packageManager === "yarn" ? "yarn" : "npm";
      return {
        type,
        packageManager,
        workspaces: resolveWorkspaces(rootDir, globs),
      };
    }
  }

  // Lerna -------------------------------------------------------------------
  const lernaPath = path.join(rootDir, "lerna.json");
  if (fs.existsSync(lernaPath)) {
    const lerna = JSON.parse(fs.readFileSync(lernaPath, "utf-8"));
    const globs: string[] = lerna.packages ?? ["packages/*"];
    return {
      type: "lerna",
      packageManager,
      workspaces: resolveWorkspaces(rootDir, globs),
    };
  }

  // Nx ----------------------------------------------------------------------
  if (fs.existsSync(path.join(rootDir, "nx.json"))) {
    return {
      type: "nx",
      packageManager,
      workspaces: resolveWorkspaces(rootDir, ["apps/*", "libs/*", "packages/*"]),
    };
  }

  // Turborepo (relies on the underlying PM workspace config) ----------------
  if (fs.existsSync(path.join(rootDir, "turbo.json"))) {
    return { type: "turbo", packageManager, workspaces: [] };
  }

  return { type: "none", packageManager, workspaces: [] };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function detectPackageManager(rootDir: string): PackageManager {
  if (fs.existsSync(path.join(rootDir, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(rootDir, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(rootDir, "package-lock.json"))) return "npm";

  const pkgJsonPath = path.join(rootDir, "package.json");
  if (fs.existsSync(pkgJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
    const pmField: string | undefined = pkg.packageManager;
    if (pmField?.startsWith("pnpm")) return "pnpm";
    if (pmField?.startsWith("yarn")) return "yarn";
  }

  return "npm";
}

/**
 * Minimal YAML parser that extracts the `packages:` list from a
 * pnpm-workspace.yaml file. Full YAML parsing is intentionally avoided
 * to keep the dependency count at zero.
 */
function parseWorkspaceGlobs(yamlContent: string): string[] {
  const globs: string[] = [];
  const lines = yamlContent.split("\n");
  let inPackages = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "packages:") {
      inPackages = true;
      continue;
    }

    if (inPackages) {
      if (trimmed.startsWith("- ")) {
        globs.push(trimmed.slice(2).replace(/['"]/g, ""));
      } else if (trimmed.length > 0 && !trimmed.startsWith("#")) {
        break; // next top-level key
      }
    }
  }

  return globs;
}

/**
 * Expand workspace globs (e.g. `apps/*`) into concrete directory paths
 * that contain a `package.json`.
 */
function resolveWorkspaces(rootDir: string, globs: string[]): string[] {
  const dirs: string[] = [];

  for (const glob of globs) {
    const baseDir = glob.replace(/\/\*\*?$/, "");
    const fullBase = path.join(rootDir, baseDir);

    if (!fs.existsSync(fullBase) || !fs.statSync(fullBase).isDirectory()) {
      continue;
    }

    if (glob.endsWith("/*") || glob.endsWith("/**")) {
      const entries = fs.readdirSync(fullBase, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          const pkgPath = path.join(fullBase, entry.name, "package.json");
          if (fs.existsSync(pkgPath)) {
            dirs.push(path.join(baseDir, entry.name));
          }
        }
      }
    } else if (fs.existsSync(path.join(rootDir, glob, "package.json"))) {
      dirs.push(glob);
    }
  }

  return dirs;
}
