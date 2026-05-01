import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import fg from "fast-glob";
import type { DeskpackConfig } from "../types.js";
import { log } from "../utils/logger.js";

interface ResolvedPackage {
  name: string;
  packageJsonPath: string;
  packageDir: string;
}

interface PlaywrightBrowserEntry {
  name: string;
  revision: string;
  installByDefault?: boolean;
  revisionOverrides?: Record<string, string>;
}

interface ExpectedPlaywrightBrowser {
  normalizedName: string;
  revisions: Set<string>;
}

/**
 * Copy packages that esbuild intentionally leaves external into the server
 * runtime. This is required for native/binary packages such as Playwright,
 * sharp, sqlite bindings, etc. to resolve after Electron packages `server/`
 * as an extra resource.
 */
export function copyRuntimeDependencies(
  rootDir: string,
  config: DeskpackConfig,
  serverDir: string,
): void {
  const packageDirs = findPackageDirs(rootDir);
  const destinationNodeModules = path.join(serverDir, "node_modules");
  const copied = new Set<string>();
  const needsPrismaArtifacts = hasPrismaArtifacts(rootDir, packageDirs);
  const needsPlaywrightBrowsers = config.backend.nativeDeps.some(isPlaywrightPackage);

  if (config.backend.nativeDeps.length === 0 && !needsPrismaArtifacts) return;

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

  if (needsPrismaArtifacts) {
    copyPrismaArtifacts(rootDir, packageDirs, destinationNodeModules, copied);
  }

  if (needsPlaywrightBrowsers) {
    copyPlaywrightBrowsers(rootDir, packageDirs, serverDir);
  }

  if (copied.size > 0) {
    log.success(
      `Copied runtime dependencies: ${[...copied].sort().join(", ")}`,
    );
  }
}

function isPlaywrightPackage(packageName: string): boolean {
  return packageName === "playwright" || packageName === "playwright-core";
}

function copyPlaywrightBrowsers(
  rootDir: string,
  packageDirs: string[],
  serverDir: string,
): void {
  const source = resolvePlaywrightBrowsersDir(rootDir, packageDirs);

  if (!source) {
    throw new Error(
      "Playwright was detected as a runtime dependency, but its browser binaries were not found. " +
        "Run `npx playwright install` in the project before `deskpack build`.",
    );
  }

  const destination = path.join(serverDir, "ms-playwright");
  if (path.resolve(source) === path.resolve(destination)) return;

  if (fs.existsSync(destination)) {
    fs.rmSync(destination, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  const copiedEntries = copyExpectedPlaywrightBrowserEntries(
    rootDir,
    packageDirs,
    source,
    destination,
  );

  if (copiedEntries.length === 0) {
    fs.cpSync(source, destination, { recursive: true, dereference: true });
  }

  const detail =
    copiedEntries.length > 0
      ? `${path.relative(rootDir, destination)} (${copiedEntries.join(", ")})`
      : path.relative(rootDir, destination);
  log.success(`Copied Playwright browsers: ${detail}`);
}

function copyExpectedPlaywrightBrowserEntries(
  rootDir: string,
  packageDirs: string[],
  source: string,
  destination: string,
): string[] {
  const expected = expectedPlaywrightBrowsers(rootDir, packageDirs);
  if (expected.length === 0) return [];

  const copied: string[] = [];
  for (const entry of safeReaddir(source)) {
    if (!entry.isDirectory()) continue;
    if (!isExpectedPlaywrightBrowserDirectory(entry.name, expected)) continue;

    fs.cpSync(path.join(source, entry.name), path.join(destination, entry.name), {
      recursive: true,
      dereference: true,
    });
    copied.push(entry.name);
  }

  if (copied.length === 0) {
    throw new Error(
      "Playwright was detected as a runtime dependency, but the installed browser binaries do not match " +
        "the project's Playwright version. Run `npx playwright install` in the project before `deskpack build`.",
    );
  }

  return copied.sort();
}

function expectedPlaywrightBrowsers(
  rootDir: string,
  packageDirs: string[],
): ExpectedPlaywrightBrowser[] {
  const manifestPath = resolvePlaywrightBrowsersManifest(rootDir, packageDirs);
  if (!manifestPath) return [];

  let manifest: { browsers?: PlaywrightBrowserEntry[] };
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
      browsers?: PlaywrightBrowserEntry[];
    };
  } catch {
    return [];
  }

  const expected: ExpectedPlaywrightBrowser[] = [];
  for (const browser of manifest.browsers ?? []) {
    if (!browser.installByDefault) continue;

    const normalizedName = browser.name.replace(/-/g, "_");
    const revisions = new Set<string>([browser.revision]);
    for (const revision of Object.values(browser.revisionOverrides ?? {})) {
      revisions.add(revision);
    }
    expected.push({ normalizedName, revisions });
  }

  return expected;
}

function isExpectedPlaywrightBrowserDirectory(
  directoryName: string,
  expected: ExpectedPlaywrightBrowser[],
): boolean {
  for (const browser of expected) {
    const nextChar = directoryName[browser.normalizedName.length];
    if (
      !directoryName.startsWith(browser.normalizedName) ||
      (nextChar !== "-" && nextChar !== "_")
    ) {
      continue;
    }

    for (const revision of browser.revisions) {
      if (directoryName.endsWith(`-${revision}`)) return true;
    }
  }

  return false;
}

function resolvePlaywrightBrowsersManifest(
  rootDir: string,
  packageDirs: string[],
): string | null {
  const resolved = resolvePackage(rootDir, packageDirs, "playwright-core");
  if (resolved) {
    const candidate = path.join(resolved.packageDir, "browsers.json");
    if (fs.existsSync(candidate)) return candidate;
  }

  for (const packageDir of packageDirs) {
    const manifestPath = path.join(packageDir, "package.json");
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const requireFromPackage = createRequire(manifestPath);
      return requireFromPackage.resolve("playwright-core/browsers.json");
    } catch {
      // Try the next workspace/package directory.
    }
  }

  return null;
}

function resolvePlaywrightBrowsersDir(
  rootDir: string,
  packageDirs: string[],
): string | null {
  const envPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (envPath && envPath !== "0") {
    const absoluteEnvPath = path.isAbsolute(envPath)
      ? envPath
      : path.resolve(rootDir, envPath);
    if (hasPlaywrightBrowserEntries(absoluteEnvPath)) return absoluteEnvPath;
  }

  for (const packageDir of packageDirs) {
    for (const candidate of [
      path.join(packageDir, "node_modules", "playwright-core", ".local-browsers"),
      path.join(packageDir, "node_modules", "playwright", ".local-browsers"),
    ]) {
      if (hasPlaywrightBrowserEntries(candidate)) return candidate;
    }
  }

  const cacheDir = defaultPlaywrightBrowsersDir();
  if (cacheDir && hasPlaywrightBrowserEntries(cacheDir)) return cacheDir;

  return null;
}

function hasPlaywrightBrowserEntries(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).some((entry) => entry.isDirectory());
  } catch {
    return false;
  }
}

function defaultPlaywrightBrowsersDir(): string | null {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    return localAppData ? path.join(localAppData, "ms-playwright") : null;
  }

  const home = process.env.HOME;
  if (!home) return null;

  if (process.platform === "darwin") {
    return path.join(home, "Library", "Caches", "ms-playwright");
  }

  return path.join(home, ".cache", "ms-playwright");
}

function safeReaddir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function hasPrismaArtifacts(rootDir: string, packageDirs: string[]): boolean {
  return packageDirs.some((dir) =>
    fs.existsSync(path.join(dir, "node_modules", ".prisma", "client")),
  ) || fs.existsSync(path.join(rootDir, "node_modules", ".prisma", "client"));
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
      "**/.deskpack/**",
      "**/deskpack/**",
      "**/deskpack-*/**",
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

    const directPackage = resolvePackageFromNodeModules(
      path.join(dir, "node_modules"),
      packageName,
    );
    if (directPackage) return directPackage;

    try {
      const requireFromPackage = createRequire(manifestPath);
      const packageJsonPath = requireFromPackage.resolve(
        `${packageName}/package.json`,
      );
      return resolvedPackage(packageName, packageJsonPath);
    } catch {
      // Try the next workspace/package directory.
    }
  }

  const directPackage = resolvePackageFromNodeModules(
    path.join(rootDir, "node_modules"),
    packageName,
  );
  if (directPackage) return directPackage;

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

  for (const nodeModulesDir of nodeModulesLookupDirs(packageDir, rootDir)) {
    const directPackage = resolvePackageFromNodeModules(
      nodeModulesDir,
      dependencyName,
    );
    if (directPackage) return directPackage;
  }

  try {
    const requireFromPackage = createRequire(manifestPath);
    const packageJsonPath = requireFromPackage.resolve(
      `${dependencyName}/package.json`,
    );
    return resolvedPackage(dependencyName, packageJsonPath);
  } catch {
    return null;
  }
}

function resolvePackageFromNodeModules(
  nodeModulesDir: string,
  packageName: string,
): ResolvedPackage | null {
  const packageJsonPath = path.join(
    nodeModulesDir,
    ...packageName.split("/"),
    "package.json",
  );

  if (!fs.existsSync(packageJsonPath)) return null;
  return resolvedPackage(packageName, packageJsonPath);
}

function resolvedPackage(
  packageName: string,
  packageJsonPath: string,
): ResolvedPackage {
  return {
    name: packageName,
    packageJsonPath,
    packageDir: path.dirname(fs.realpathSync(packageJsonPath)),
  };
}

function nodeModulesLookupDirs(startDir: string, rootDir: string): string[] {
  const dirs = new Set<string>();
  let current = startDir;
  const filesystemRoot = path.parse(startDir).root;

  while (true) {
    dirs.add(path.join(current, "node_modules"));
    if (current === rootDir || current === filesystemRoot) break;
    current = path.dirname(current);
  }

  dirs.add(path.join(rootDir, "node_modules"));
  return [...dirs];
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

function copyPrismaArtifacts(
  rootDir: string,
  packageDirs: string[],
  destinationNodeModules: string,
  copied: Set<string>,
): void {
  const prismaClientDir = resolvePrismaClientDir(rootDir, packageDirs);
  if (prismaClientDir) {
    const destination = path.join(destinationNodeModules, ".prisma", "client");
    if (fs.existsSync(destination)) {
      fs.rmSync(destination, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(prismaClientDir, destination, { recursive: true, dereference: true });
    copied.add(".prisma/client");
  }

  const prismaPackageNames = ["@prisma/client"];
  for (const packageName of prismaPackageNames) {
    const resolved = resolvePackage(rootDir, packageDirs, packageName);
    if (resolved) {
      copyPackageTree(rootDir, resolved, destinationNodeModules, copied, false);
    }
  }
}

function resolvePrismaClientDir(rootDir: string, packageDirs: string[]): string | null {
  for (const dir of packageDirs) {
    const candidate = path.join(dir, "node_modules", ".prisma", "client");
    if (fs.existsSync(candidate)) return candidate;
  }

  const rootCandidate = path.join(rootDir, "node_modules", ".prisma", "client");
  if (fs.existsSync(rootCandidate)) return rootCandidate;
  return null;
}
