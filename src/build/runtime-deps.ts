import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import fg from "fast-glob";
import type { ShipdeskConfig } from "../types.js";
import { log } from "../utils/logger.js";

interface ResolvedPackage {
  name: string;
  packageJsonPath: string;
  packageDir: string;
}

/**
 * Copy packages that esbuild intentionally leaves external into the server
 * runtime. This is required for native/binary packages such as Playwright,
 * sharp, sqlite bindings, etc. to resolve after Electron packages `server/`
 * as an extra resource.
 */
export function copyRuntimeDependencies(
  rootDir: string,
  config: ShipdeskConfig,
  serverDir: string,
): void {
  if (config.backend.nativeDeps.length === 0) return;

  const packageDirs = findPackageDirs(rootDir);
  const destinationNodeModules = path.join(serverDir, "node_modules");
  const copied = new Set<string>();

  fs.mkdirSync(destinationNodeModules, { recursive: true });

  for (const dep of config.backend.nativeDeps) {
    const resolved = resolvePackage(rootDir, packageDirs, dep);

    if (!resolved) {
      throw new Error(
        `Native dependency "${dep}" was externalized but could not be resolved from the project. ` +
          "Install it in the backend package or remove it from nativeDeps.",
      );
    }

    copyPackageTree(rootDir, resolved, destinationNodeModules, copied, true);
  }

  if (copied.size > 0) {
    log.success(
      `Copied runtime dependencies: ${[...copied].sort().join(", ")}`,
    );
  }
}

function findPackageDirs(rootDir: string): string[] {
  const packageJsonPaths = fg.sync("**/package.json", {
    cwd: rootDir,
    absolute: true,
    dot: false,
    ignore: [
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/.shipdesk/**",
      "**/shipdesk/**",
      "**/shipdesk-*/**",
    ],
  });

  return [
    rootDir,
    ...packageJsonPaths.map((pkgPath) => path.dirname(pkgPath)),
  ];
}

function resolvePackage(
  rootDir: string,
  packageDirs: string[],
  packageName: string,
): ResolvedPackage | null {
  for (const dir of packageDirs) {
    const manifestPath = path.join(dir, "package.json");
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const requireFromPackage = createRequire(manifestPath);
      const packageJsonPath = requireFromPackage.resolve(
        `${packageName}/package.json`,
      );
      return {
        name: packageName,
        packageJsonPath,
        packageDir: path.dirname(fs.realpathSync(packageJsonPath)),
      };
    } catch {
      // Try the next workspace/package directory.
    }
  }

  const directPackageJsonPath = path.join(
    rootDir,
    "node_modules",
    packageName,
    "package.json",
  );
  if (fs.existsSync(directPackageJsonPath)) {
    return {
      name: packageName,
      packageJsonPath: directPackageJsonPath,
      packageDir: path.dirname(fs.realpathSync(directPackageJsonPath)),
    };
  }

  return null;
}

function copyPackageTree(
  rootDir: string,
  pkg: ResolvedPackage,
  destinationNodeModules: string,
  copied: Set<string>,
  required: boolean,
): void {
  if (copied.has(pkg.name)) return;

  if (!fs.existsSync(pkg.packageJsonPath)) {
    if (required) {
      throw new Error(`Could not find package.json for ${pkg.name}`);
    }
    return;
  }

  copyPackageDir(pkg, destinationNodeModules);
  copied.add(pkg.name);

  const manifest = JSON.parse(
    fs.readFileSync(pkg.packageJsonPath, "utf-8"),
  ) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };

  const dependencyNames = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ];

  for (const dependencyName of dependencyNames) {
    const dependency = resolvePackageFromPackage(
      rootDir,
      pkg.packageDir,
      dependencyName,
    );

    if (!dependency) {
      continue;
    }

    copyPackageTree(rootDir, dependency, destinationNodeModules, copied, false);
  }
}

function resolvePackageFromPackage(
  rootDir: string,
  packageDir: string,
  dependencyName: string,
): ResolvedPackage | null {
  const manifestPath = path.join(packageDir, "package.json");

  try {
    const requireFromPackage = createRequire(manifestPath);
    const packageJsonPath = requireFromPackage.resolve(
      `${dependencyName}/package.json`,
    );
    return {
      name: dependencyName,
      packageJsonPath,
      packageDir: path.dirname(fs.realpathSync(packageJsonPath)),
    };
  } catch {
    const directPackageJsonPath = path.join(
      rootDir,
      "node_modules",
      dependencyName,
      "package.json",
    );

    if (!fs.existsSync(directPackageJsonPath)) return null;

    return {
      name: dependencyName,
      packageJsonPath: directPackageJsonPath,
      packageDir: path.dirname(fs.realpathSync(directPackageJsonPath)),
    };
  }
}

function copyPackageDir(
  pkg: ResolvedPackage,
  destinationNodeModules: string,
): void {
  const destination = path.join(destinationNodeModules, ...pkg.name.split("/"));

  if (fs.existsSync(destination)) {
    fs.rmSync(destination, { recursive: true, force: true });
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(pkg.packageDir, destination, {
    recursive: true,
    dereference: true,
    filter: (source) => {
      const relative = path.relative(pkg.packageDir, source);
      if (!relative) return true;
      return !relative.split(path.sep).includes("node_modules");
    },
  });
}
