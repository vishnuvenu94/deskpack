import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { DeskpackConfig } from "../types.js";
import { execPassthrough, resolvePlatformCommand } from "../utils/exec.js";
import { log } from "../utils/logger.js";

const PACKAGE_NAME = "better-sqlite3";
const BINARY_RELATIVE_PATH = path.join("build", "Release", "better_sqlite3.node");

export interface BetterSqlite3RuntimeTarget {
  packageDir: string;
  binaryPath: string;
}

export interface BetterSqlite3SourcePackage {
  projectDir: string;
  packageDir: string;
  binaryPath: string;
}

export function findBetterSqlite3RuntimeTargets(runtimeDir: string): BetterSqlite3RuntimeTarget[] {
  const targets = new Map<string, BetterSqlite3RuntimeTarget>();

  for (const nodeModulesDir of findNodeModulesDirs(runtimeDir)) {
    for (const candidate of packageCandidates(nodeModulesDir)) {
      let packageJsonPath: string;
      try {
        packageJsonPath = fs.realpathSync(candidate.packageJsonPath);
      } catch {
        continue;
      }

      let manifest: { name?: unknown };
      try {
        manifest = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
          name?: unknown;
        };
      } catch {
        continue;
      }

      if (manifest.name !== PACKAGE_NAME) continue;

      const packageDir = path.dirname(packageJsonPath);
      const binaryPath = path.join(packageDir, BINARY_RELATIVE_PATH);
      targets.set(binaryPath, { packageDir, binaryPath });
    }
  }

  return [...targets.values()].sort((a, b) => a.binaryPath.localeCompare(b.binaryPath));
}

export function findBetterSqlite3SourcePackage(
  rootDir: string,
  config: DeskpackConfig,
): BetterSqlite3SourcePackage | null {
  const packageRoots = uniqueExistingPackageRoots([
    path.resolve(rootDir, config.backend.path || "."),
    path.resolve(rootDir, config.frontend.path),
    rootDir,
  ]);

  for (const projectDir of packageRoots) {
    try {
      const requireFromProject = createRequire(path.join(projectDir, "package.json"));
      const packageJsonPath = requireFromProject.resolve(`${PACKAGE_NAME}/package.json`);
      const packageDir = path.dirname(fs.realpathSync(packageJsonPath));
      return {
        projectDir,
        packageDir,
        binaryPath: path.join(packageDir, BINARY_RELATIVE_PATH),
      };
    } catch {
      // Try the next package root.
    }
  }

  return null;
}

export function createBetterSqlite3RebuildArgs(input: {
  electronVersion: string;
  projectDir: string;
}): string[] {
  return [
    "--version",
    input.electronVersion,
    "--module-dir",
    input.projectDir,
    "--force",
    "--only",
    PACKAGE_NAME,
  ];
}

export async function rebuildBetterSqlite3ForElectron(
  rootDir: string,
  desktopDir: string,
  runtimeDir: string,
  config: DeskpackConfig,
  options: { skipPackage?: boolean } = {},
): Promise<void> {
  const targets = findBetterSqlite3RuntimeTargets(runtimeDir);
  if (targets.length === 0) return;

  const electronRebuildBin = electronRebuildBinaryPath(desktopDir);
  const electronVersion = readElectronVersion(desktopDir);

  if (!fs.existsSync(electronRebuildBin) || !electronVersion) {
    const message =
      "better-sqlite3 was copied into the desktop runtime, but Electron rebuild tooling is not installed. " +
      "Run `deskpack init --force` or run a full package build after Electron is installed.";
    if (options.skipPackage) {
      log.warn(message);
      return;
    }
    throw new Error(message);
  }

  const source = findBetterSqlite3SourcePackage(rootDir, config);
  if (!source) {
    throw new Error(
      "better-sqlite3 was copied into the desktop runtime, but deskpack could not resolve the original project dependency. " +
        "Run your package manager install command, then rebuild.",
    );
  }

  const originalBinary = fs.existsSync(source.binaryPath)
    ? fs.readFileSync(source.binaryPath)
    : null;

  try {
    log.step(
      "Rebuilding better-sqlite3",
      `Electron ${electronVersion} native binding from ${path.relative(rootDir, source.projectDir) || "."}`,
    );

    const exitCode = await execPassthrough(
      electronRebuildBin,
      createBetterSqlite3RebuildArgs({
        electronVersion,
        projectDir: source.projectDir,
      }),
      { cwd: desktopDir },
    );

    if (exitCode !== 0) {
      throw new Error(
        "better-sqlite3 rebuild failed. If no Electron prebuild is available, install the native build prerequisites " +
          "for node-gyp (Python with distutils/setuptools and platform compiler tools), then run `deskpack build` again.",
      );
    }

    if (!fs.existsSync(source.binaryPath)) {
      throw new Error(
        `better-sqlite3 rebuild completed but did not produce ${source.binaryPath}.`,
      );
    }

    for (const target of targets) {
      fs.mkdirSync(path.dirname(target.binaryPath), { recursive: true });
      fs.copyFileSync(source.binaryPath, target.binaryPath);
    }

    log.success(`Copied Electron better-sqlite3 binding to ${targets.length} runtime package(s)`);
  } finally {
    if (originalBinary) {
      fs.writeFileSync(source.binaryPath, originalBinary);
    } else {
      fs.rmSync(source.binaryPath, { force: true });
    }
  }
}

export function readElectronVersion(desktopDir: string): string | null {
  const packageJsonPath = path.join(desktopDir, "node_modules", "electron", "package.json");
  if (!fs.existsSync(packageJsonPath)) return null;

  try {
    const manifest = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
      version?: unknown;
    };
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

function electronRebuildBinaryPath(desktopDir: string): string {
  return path.join(
    desktopDir,
    "node_modules",
    ".bin",
    resolvePlatformCommand("electron-rebuild"),
  );
}

function uniqueExistingPackageRoots(candidates: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const packageJsonPath = path.join(candidate, "package.json");
    if (!fs.existsSync(packageJsonPath)) continue;
    const real = fs.realpathSync(candidate);
    if (seen.has(real)) continue;
    seen.add(real);
    result.push(real);
  }

  return result;
}

function findNodeModulesDirs(runtimeDir: string): string[] {
  const result: string[] = [];
  const stack = [runtimeDir];

  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name === "node_modules") {
        result.push(full);
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(full);
      }
    }
  }

  return result;
}

function packageCandidates(nodeModulesDir: string): Array<{ packageJsonPath: string }> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(nodeModulesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const result: Array<{ packageJsonPath: string }> = [];
  for (const entry of entries) {
    const entryPath = path.join(nodeModulesDir, entry.name);
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      for (const scoped of safeReaddir(entryPath)) {
        if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue;
        result.push({
          packageJsonPath: path.join(entryPath, scoped.name, "package.json"),
        });
      }
      continue;
    }

    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    result.push({
      packageJsonPath: path.join(entryPath, "package.json"),
    });
  }

  return result;
}

function safeReaddir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
