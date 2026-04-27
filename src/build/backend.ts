import fs from "node:fs";
import path from "node:path";
import esbuild from "esbuild";
import type { DeskpackConfig } from "../types.js";
import { execPassthrough, resolvePlatformCommand } from "../utils/exec.js";
import { log } from "../utils/logger.js";

/**
 * Bundle the backend server into a single `server.cjs` file using esbuild.
 *
 * Native modules (e.g. playwright, sharp) are marked as external so they
 * are not inlined and can be provided at runtime.
 */
export async function bundleBackend(
  rootDir: string,
  config: DeskpackConfig,
  outDir: string,
): Promise<void> {
  const entry = await prepareBackendEntry(rootDir, config);
  const launchFile = path.join(outDir, "server.mjs");
  const bundledModuleFile = resolveBundledModuleFile(rootDir, entry, outDir);

  if (!fs.existsSync(entry)) {
    throw new Error(`Backend entry point not found: ${entry}`);
  }

  const external = [...new Set(config.backend.nativeDeps)];

  // NestJS core lazily requires optional packages at runtime.
  // Mark them as external so esbuild doesn't fail when they aren't installed.
  if (config.backend.framework === "nestjs") {
    const nestjsOptional = [
      "@nestjs/microservices",
      "@nestjs/microservices/microservices-module",
      "@nestjs/websockets",
      "@nestjs/websockets/socket-module",
    ];
    for (const dep of nestjsOptional) {
      if (!external.includes(dep)) external.push(dep);
    }
  }

  log.step("Bundling backend", `${path.relative(rootDir, entry)} → server.mjs`);

  if (external.length > 0) {
    log.dim(`  External modules: ${external.join(", ")}`);
  }

  fs.mkdirSync(path.dirname(bundledModuleFile), { recursive: true });

  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    outfile: bundledModuleFile,
    external,
    sourcemap: true,
    minify: false, // keep readable for debugging
    banner: {
      js: [
        'import { createRequire as __deskpackCreateRequire } from "node:module";',
        'import { fileURLToPath as __deskpackFileURLToPath } from "node:url";',
        'import { dirname as __deskpackDirname } from "node:path";',
        "const require = __deskpackCreateRequire(import.meta.url);",
        "var __filename = __deskpackFileURLToPath(import.meta.url);",
        "var __dirname = __deskpackDirname(__filename);",
        "// Bundled by deskpack",
      ].join("\n"),
    },
    logLevel: "warning",
  });

  writeBackendLauncher(launchFile, bundledModuleFile);

  log.success(`Backend bundled → ${path.relative(rootDir, launchFile)}`);
}

async function prepareBackendEntry(
  rootDir: string,
  config: DeskpackConfig,
): Promise<string> {
  const sourceEntry = path.resolve(rootDir, config.backend.entry);

  if (config.backend.framework !== "nestjs") {
    return sourceEntry;
  }

  await buildNestBackend(rootDir, config);

  const compiledEntry = resolveNestCompiledEntry(rootDir, config);
  if (compiledEntry && fs.existsSync(compiledEntry)) {
    return compiledEntry;
  }

  return sourceEntry;
}

async function buildNestBackend(
  rootDir: string,
  config: DeskpackConfig,
): Promise<void> {
  const backendDir = path.resolve(rootDir, config.backend.path || ".");
  const packageJsonPath = path.join(backendDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) return;

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
    scripts?: Record<string, string>;
  };
  if (!pkg.scripts?.build) return;

  log.step("Building NestJS backend", `${config.monorepo.packageManager} run build`);
  const exitCode = await execPassthrough(
    resolvePlatformCommand(config.monorepo.packageManager),
    ["run", "build"],
    { cwd: backendDir },
  );

  if (exitCode !== 0) {
    throw new Error(`NestJS backend build failed with exit code ${exitCode}`);
  }
}

function resolveNestCompiledEntry(
  rootDir: string,
  config: DeskpackConfig,
): string | null {
  if (!/\.(ts|tsx)$/.test(config.backend.entry)) {
    return null;
  }

  const backendPath = config.backend.path || ".";
  const relativeToBackend = path.relative(
    path.resolve(rootDir, backendPath),
    path.resolve(rootDir, config.backend.entry),
  );
  const withoutSrcPrefix = relativeToBackend.replace(/^src[\\/]/, "");
  const compiledRelative = withoutSrcPrefix.replace(/\.(ts|tsx)$/, ".js");

  return path.resolve(rootDir, backendPath, "dist", compiledRelative);
}

function resolveBundledModuleFile(
  rootDir: string,
  entry: string,
  outDir: string,
): string {
  const relativeEntry = path.relative(rootDir, entry);
  const outputRelative = relativeEntry.replace(/\.[^.]+$/, ".mjs");
  return path.join(outDir, outputRelative);
}

function writeBackendLauncher(
  launchFile: string,
  bundledModuleFile: string,
): void {
  if (path.resolve(launchFile) === path.resolve(bundledModuleFile)) {
    return;
  }

  let importPath = path.relative(path.dirname(launchFile), bundledModuleFile);
  if (!importPath.startsWith(".")) {
    importPath = `./${importPath}`;
  }
  importPath = importPath.split(path.sep).join("/");

  fs.writeFileSync(
    launchFile,
    [
      "// Generated by deskpack",
      `import ${JSON.stringify(importPath)};`,
      "",
    ].join("\n"),
  );
}
