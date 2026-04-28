import fs from "node:fs";
import path from "node:path";
import type { BackendInfo, DatabaseInfo, FrontendInfo } from "../types.js";

const SQLITE_TEMPLATE_EXTENSIONS = new Set([".db", ".sqlite", ".sqlite3"]);
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".deskpack",
  "dist",
  "build",
  ".next",
  ".output",
  "coverage",
]);

export function detectDatabase(
  rootDir: string,
  frontend: FrontendInfo,
  backend: BackendInfo,
): DatabaseInfo | undefined {
  const packageDirs = uniquePackageDirs(rootDir, [backend.path, frontend.path, "."]);
  const deps = collectDependencies(rootDir, packageDirs);
  const prismaSchema = findPrismaSqliteSchema(rootDir, packageDirs);
  const drizzle = findDrizzleConfig(rootDir, packageDirs, deps);
  const driver = detectSqliteDriver(deps, Boolean(prismaSchema), Boolean(drizzle));

  if (!driver) return undefined;

  const warnings: string[] = [];
  const templatePath = detectTemplateDatabase(rootDir, warnings);
  const migrations = detectMigrations(rootDir, prismaSchema, drizzle);

  if (driver === "prisma") {
    warnings.push(
      "Prisma SQLite detected. Deskpack sets DATABASE_URL at runtime but does not run migrations automatically.",
    );
  } else if (driver === "drizzle") {
    warnings.push(
      "Drizzle SQLite detected. Deskpack sets DATABASE_URL at runtime but does not run migrations automatically.",
    );
  }

  return {
    provider: "sqlite",
    mode: "managed-local",
    driver,
    ...(templatePath ? { templatePath } : {}),
    runtimeFileName: "app.db",
    userDataSubdir: "database",
    env: {
      pathVar: "DESKPACK_DB_PATH",
      urlVar: "DATABASE_URL",
    },
    ...(migrations ? { migrations } : {}),
    warnings,
  };
}

function uniquePackageDirs(rootDir: string, paths: string[]): string[] {
  const dirs = new Set<string>();
  for (const entry of paths) {
    if (!entry) continue;
    const full = path.resolve(rootDir, entry);
    if (fs.existsSync(path.join(full, "package.json"))) {
      dirs.add(full);
    }
  }
  return [...dirs];
}

function collectDependencies(rootDir: string, packageDirs: string[]): Record<string, string> {
  const deps: Record<string, string> = {};

  for (const dir of packageDirs) {
    const pkgPath = path.join(dir, "package.json");
    if (!fs.existsSync(pkgPath)) continue;

    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    Object.assign(deps, pkg.dependencies, pkg.devDependencies);
  }

  const rootPkgPath = path.join(rootDir, "package.json");
  if (fs.existsSync(rootPkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    Object.assign(deps, pkg.dependencies, pkg.devDependencies);
  }

  return deps;
}

function detectSqliteDriver(
  deps: Record<string, string>,
  hasPrismaSqlite: boolean,
  hasDrizzleSqlite: boolean,
): DatabaseInfo["driver"] | null {
  if (hasPrismaSqlite) return "prisma";
  if (hasDrizzleSqlite) return "drizzle";
  if ("better-sqlite3" in deps) return "better-sqlite3";
  if ("sqlite3" in deps) return "sqlite3";
  return null;
}

function findPrismaSqliteSchema(rootDir: string, packageDirs: string[]): string | null {
  const candidates = [
    path.join(rootDir, "prisma", "schema.prisma"),
    ...packageDirs.map((dir) => path.join(dir, "prisma", "schema.prisma")),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const content = fs.readFileSync(candidate, "utf-8");
    if (/provider\s*=\s*["']sqlite["']/.test(content)) {
      return path.relative(rootDir, candidate);
    }
  }

  return null;
}

function findDrizzleConfig(
  rootDir: string,
  packageDirs: string[],
  deps: Record<string, string>,
): string | null {
  if (!("drizzle-orm" in deps) && !("drizzle-kit" in deps)) return null;

  const configNames = [
    "drizzle.config.ts",
    "drizzle.config.js",
    "drizzle.config.mts",
    "drizzle.config.mjs",
  ];

  for (const dir of [rootDir, ...packageDirs]) {
    for (const name of configNames) {
      const candidate = path.join(dir, name);
      if (!fs.existsSync(candidate)) continue;
      const content = fs.readFileSync(candidate, "utf-8");
      if (/sqlite|better-sqlite3|sqlite3|libsql/i.test(content)) {
        return path.relative(rootDir, candidate);
      }
    }
  }

  return null;
}

function detectMigrations(
  rootDir: string,
  prismaSchema: string | null,
  drizzleConfig: string | null,
): DatabaseInfo["migrations"] | undefined {
  if (prismaSchema) {
    const migrationsPath = path.join(path.dirname(prismaSchema), "migrations");
    if (fs.existsSync(path.join(rootDir, migrationsPath))) {
      return { tool: "prisma", path: migrationsPath, autoRun: false };
    }
    return { tool: "prisma", autoRun: false };
  }

  if (drizzleConfig) {
    for (const candidate of ["drizzle", "migrations"]) {
      if (fs.existsSync(path.join(rootDir, candidate))) {
        return { tool: "drizzle", path: candidate, autoRun: false };
      }
    }
    return { tool: "drizzle", autoRun: false };
  }

  return { tool: "none", autoRun: false };
}

function detectTemplateDatabase(rootDir: string, warnings: string[]): string | undefined {
  const candidates: string[] = [];
  walk(rootDir, (file) => {
    if (SQLITE_TEMPLATE_EXTENSIONS.has(path.extname(file).toLowerCase())) {
      candidates.push(path.relative(rootDir, file));
    }
  });

  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    warnings.push(
      `Multiple SQLite database files found; not choosing a template automatically. Found: ${formatFileList(candidates)}`,
    );
  }

  return undefined;
}

function formatFileList(files: string[]): string {
  const max = 4;
  const head = files.slice(0, max);
  const extra = files.length > max ? ` (+${files.length - max} more)` : "";
  return head.join(", ") + extra;
}

function walk(rootDir: string, onFile: (abs: string) => void): void {
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name)) continue;
        stack.push(full);
      } else if (entry.isFile()) {
        onFile(full);
      }
    }
  }
}
