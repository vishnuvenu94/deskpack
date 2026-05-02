import fs from "node:fs";
import path from "node:path";
import type { DeskpackConfig } from "../types.js";
import { execPassthrough, resolveLocalBin } from "../utils/exec.js";
import { log } from "../utils/logger.js";

export async function generatePrismaClient(
  rootDir: string,
  config: DeskpackConfig,
): Promise<void> {
  if (!usesPrisma(rootDir, config)) return;

  const schemaPath = findPrismaSchema(rootDir, config);
  if (!schemaPath) {
    throw new Error(
      "Prisma was detected, but Deskpack could not find schema.prisma. " +
        "Add the schema to the project or set up Prisma before building.",
    );
  }

  const cwd = findNearestPackageDir(path.dirname(schemaPath), rootDir);
  const prismaBin = resolvePrismaBin(rootDir, cwd);
  if (!prismaBin) {
    throw new Error(
      "Prisma was detected, but the local Prisma CLI was not found. " +
        "Install `prisma` in the backend package before building.",
    );
  }

  log.step(
    "Generating Prisma Client",
    `prisma generate --schema ${path.relative(rootDir, schemaPath)}`,
  );

  const exitCode = await execPassthrough(
    prismaBin,
    ["generate", "--schema", path.relative(cwd, schemaPath)],
    { cwd, env: prismaGenerateEnv(rootDir, config, schemaPath) },
  );

  if (exitCode !== 0) {
    throw new Error(`Prisma Client generation failed with exit code ${exitCode}`);
  }
}

function prismaGenerateEnv(
  rootDir: string,
  config: DeskpackConfig,
  schemaPath: string,
): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const database = config.database;
  if (database?.driver !== "prisma") return env;

  const urlVar = database.env.urlVar;
  if (env[urlVar]) return env;

  const sqlitePath = database.templatePath
    ? path.resolve(rootDir, database.templatePath)
    : path.join(path.dirname(schemaPath), "dev.db");
  env[urlVar] = `file:${sqlitePath}`;
  return env;
}

function usesPrisma(rootDir: string, config: DeskpackConfig): boolean {
  if (config.database?.driver === "prisma") return true;

  for (const dir of packageSearchDirs(rootDir, config)) {
    const pkgPath = path.join(dir, "package.json");
    if (!fs.existsSync(pkgPath)) continue;

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      if (pkg.dependencies?.["@prisma/client"] || pkg.devDependencies?.["@prisma/client"]) {
        return true;
      }
    } catch {
      // Ignore malformed package.json here; config loading reports that earlier.
    }
  }

  return false;
}

function findPrismaSchema(rootDir: string, config: DeskpackConfig): string | null {
  const candidates = new Set<string>();
  const backendDir = path.resolve(rootDir, config.backend.path || ".");

  if (config.database?.migrations?.path) {
    candidates.add(path.join(rootDir, path.dirname(config.database.migrations.path), "schema.prisma"));
  }

  candidates.add(path.join(backendDir, "prisma", "schema.prisma"));
  candidates.add(path.join(rootDir, "prisma", "schema.prisma"));

  for (const candidate of candidates) {
    if (isPrismaSchema(candidate)) return candidate;
  }

  const found: string[] = [];
  walk(rootDir, (file) => {
    if (path.basename(file) === "schema.prisma" && isPrismaSchema(file)) {
      found.push(file);
    }
  });

  found.sort((a, b) => schemaScore(b, backendDir) - schemaScore(a, backendDir));
  return found[0] ?? null;
}

function schemaScore(schemaPath: string, backendDir: string): number {
  const relativeToBackend = path.relative(backendDir, schemaPath);
  if (!relativeToBackend.startsWith("..") && !path.isAbsolute(relativeToBackend)) {
    return 2;
  }
  if (schemaPath.includes(`${path.sep}prisma${path.sep}schema.prisma`)) {
    return 1;
  }
  return 0;
}

function isPrismaSchema(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf-8");
  return /provider\s*=\s*["']prisma-client-js["']/.test(content);
}

function resolvePrismaBin(rootDir: string, cwd: string): string | null {
  for (const dir of [cwd, rootDir]) {
    const candidate = resolveLocalBin(dir, "prisma");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function findNearestPackageDir(startDir: string, rootDir: string): string {
  let current = startDir;
  const filesystemRoot = path.parse(startDir).root;

  while (true) {
    if (fs.existsSync(path.join(current, "package.json"))) return current;
    if (current === rootDir || current === filesystemRoot) return rootDir;
    current = path.dirname(current);
  }
}

function packageSearchDirs(rootDir: string, config: DeskpackConfig): string[] {
  return [
    path.resolve(rootDir, config.backend.path || "."),
    path.resolve(rootDir, config.frontend.path || "."),
    rootDir,
  ];
}

function walk(rootDir: string, onFile: (abs: string) => void): void {
  const stack = [rootDir];
  const skipDirs = new Set([
    "node_modules",
    ".git",
    ".deskpack",
    "dist",
    "build",
    ".next",
    ".output",
    "coverage",
  ]);

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
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) stack.push(fullPath);
      } else if (entry.isFile()) {
        onFile(fullPath);
      }
    }
  }
}
