import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { buildFrontend } from "../build/frontend.js";
import { bundleBackend } from "../build/backend.js";
import { copyRuntimeDependencies } from "../build/runtime-deps.js";
import { copyNextStandaloneRuntime } from "../build/next-runtime.js";
import { copyDatabaseAssets } from "../build/database.js";
import { rebuildBetterSqlite3ForElectron } from "../build/better-sqlite3.js";
import { packageElectron } from "../build/package.js";
import {
  inspectPlatformBuild,
  normalizeBuildPlatform,
  platformLabel,
} from "../build/platform.js";
import { generateElectronMain } from "../generate/electron-main.js";
import { loadConfig } from "../config.js";
import { detectFrontend } from "../detect/frontend.js";
import { detectTopology } from "../detect/topology.js";
import { assertDeskpackStaticHtmlOutput } from "../build/static-output.js";
import { log } from "../utils/logger.js";
import type { DeskpackConfig } from "../types.js";

/**
 * `deskpack build`
 *
 * 1. Build the frontend.
 * 2. Bundle the backend with esbuild.
 * 3. Copy the built frontend into the server bundle.
 * 4. Regenerate the Electron main process.
 * 5. (Optional) Run electron-builder to create installers.
 */
export async function buildCommand(
  rootDir: string,
  options: { skipPackage?: boolean; platform?: string },
): Promise<void> {
  log.banner();
  let config = loadConfig(rootDir);
  const targetPlatform = normalizeBuildPlatform(options.platform);

  if (config.topology === "ssr-framework") {
    const detail =
      config.topologyEvidence.warnings.length > 0
        ? config.topologyEvidence.warnings.join(" ")
        : 'SSR/server runtime topology is not supported unless it uses a supported standalone runtime such as Next.js output: "standalone".';
    throw new Error(detail);
  }

  if (config.topology === "unsupported") {
    const detail =
      config.topologyEvidence.warnings.length > 0
        ? ` ${config.topologyEvidence.warnings.join(" ")}`
        : "";
    throw new Error(
      "Unsupported topology. Deskpack could not determine a reliable frontend/backend runtime layout." +
        detail,
    );
  }

  const desktopDir = path.join(rootDir, ".deskpack", "desktop");
  const serverDir = path.join(desktopDir, "server");

  const hasElectron = fs.existsSync(path.join(desktopDir, "node_modules", "electron"));
  if (!hasElectron && !options.skipPackage) {
    log.error(
      `Desktop not initialised. Run ${chalk.cyan("npx deskpack init")} first.`,
    );
    process.exit(1);
  }
  if (!hasElectron && options.skipPackage) {
    log.warn("Electron is not installed; continuing because --skip-package was set.");
  }

  if (!options.skipPackage) {
    const decision = inspectPlatformBuild(config, targetPlatform);

    log.info(
      `Packaging target: ${platformLabel(decision.targetPlatform)} ` +
        `(host: ${platformLabel(decision.hostPlatform)})`,
    );

    for (const warning of decision.warnings) {
      log.warn(warning);
    }

    if (!decision.allowed) {
      log.blank();
      log.error("Cannot create this platform build reliably from the current OS.");
      for (const reason of decision.reasons) {
        log.step("Reason", reason);
      }
      log.blank();
      log.info(
        `Build this installer on ${platformLabel(decision.targetPlatform)} instead.`,
      );
      throw new Error("Platform build refused by deskpack policy.");
    }

    log.blank();
  }

  // Clean and recreate the server output directory.
  if (fs.existsSync(serverDir)) {
    fs.rmSync(serverDir, { recursive: true });
  }
  fs.mkdirSync(serverDir, { recursive: true });

  log.info("Building desktop application…");
  log.blank();

  // 1. Build frontend -------------------------------------------------------
  await buildFrontend(rootDir, config);
  config = recoverStaleTopology(rootDir, config);

  if (config.topology === "next-standalone-runtime") {
    const nextRuntimeDir = path.join(serverDir, "next");
    copyNextStandaloneRuntime(rootDir, config, serverDir);
    copyDatabaseAssets(rootDir, config, serverDir);
    await rebuildBetterSqlite3ForElectron(rootDir, desktopDir, nextRuntimeDir, config, {
      skipPackage: options.skipPackage,
    });

    fs.writeFileSync(
      path.join(desktopDir, "main.cjs"),
      generateElectronMain(config),
    );

    if (!options.skipPackage) {
      log.blank();
      warnWindowsNativeRuntimePrerequisite(config, targetPlatform);
      await packageElectron(rootDir, targetPlatform);
    }

    log.blank();
    log.success(chalk.bold("Build complete!"));
    if (options.skipPackage) {
      log.step("Bundled files", `.deskpack${path.sep}desktop${path.sep}server`);
      log.dim("  Run without --skip-package to create installers");
    }
    log.blank();
    return;
  }

  // 2. Copy built frontend to server bundle ---------------------------------
  let frontendDistPath = path.resolve(rootDir, config.frontend.distDir);

  if (!fs.existsSync(frontendDistPath)) {
    const detectedFrontend = detectFrontend(rootDir, config.frontend.path);
    if (detectedFrontend && detectedFrontend.distDir !== config.frontend.distDir) {
      const detectedDistPath = path.resolve(rootDir, detectedFrontend.distDir);
      if (fs.existsSync(detectedDistPath)) {
        log.info(`Resolved frontend output directory: ${detectedFrontend.distDir}`);
        frontendDistPath = detectedDistPath;
      }
    }
  }

  // Angular 17+ places static output inside a `browser` subdirectory.
  // If the configured distDir doesn't contain index.html at its root,
  // check for a browser/ subdirectory that does.
  if (!fs.existsSync(path.join(frontendDistPath, "index.html"))) {
    const browserSubdir = path.join(frontendDistPath, "browser");
    if (
      fs.existsSync(browserSubdir) &&
      fs.existsSync(path.join(browserSubdir, "index.html"))
    ) {
      log.info("Resolved Angular browser output directory");
      frontendDistPath = browserSubdir;
    }
  }

  assertDeskpackStaticHtmlOutput(frontendDistPath);

  copyDirSync(frontendDistPath, path.join(serverDir, "web-dist"));

  // Preserve the original dist path inside the server runtime as well. Many
  // backends resolve static assets relative to process.cwd() or import.meta.url
  // using paths like apps/web/dist rather than a generic web-dist directory.
  const preservedFrontendDistPath = path.join(serverDir, config.frontend.distDir);
  if (path.resolve(preservedFrontendDistPath) !== path.resolve(path.join(serverDir, "web-dist"))) {
    copyDirSync(frontendDistPath, preservedFrontendDistPath);
  }

  // For backend-serves-frontend topology, backends often resolve static files
  // relative to __dirname (e.g., path.join(__dirname, '..')). After bundling,
  // __dirname becomes server/src/, so the parent dir is server/. Copy the
  // frontend build output to the server root so these relative resolutions work.
  if (config.topology === "backend-serves-frontend") {
    copyDirSync(frontendDistPath, serverDir);
  }

  log.success("Copied frontend build to server bundle");

  // 3. Bundle backend -------------------------------------------------------
  if (config.topology === "frontend-only-static" || config.backend.path === "") {
    log.success("No backend detected; skipping backend bundle");
  } else {
    await bundleBackend(rootDir, config, serverDir);
    copyRuntimeDependencies(rootDir, config, serverDir);
    await rebuildBetterSqlite3ForElectron(rootDir, desktopDir, serverDir, config, {
      skipPackage: options.skipPackage,
    });
  }
  copyDatabaseAssets(rootDir, config, serverDir);

  // 4. Regenerate Electron main (in case config changed) --------------------
  fs.writeFileSync(
    path.join(desktopDir, "main.cjs"),
    generateElectronMain(config),
  );

  // 5. Package (optional) ---------------------------------------------------
  if (!options.skipPackage) {
    log.blank();
    warnWindowsNativeRuntimePrerequisite(config, targetPlatform);
    await packageElectron(rootDir, targetPlatform);
  }

  // --- Summary -------------------------------------------------------------
  log.blank();
  log.success(chalk.bold("Build complete!"));

  if (!options.skipPackage) {
    const releaseDir = path.join(rootDir, ".deskpack", "release");
    if (fs.existsSync(releaseDir)) {
      log.blank();
      log.info("Output files:");
      const files = fs.readdirSync(releaseDir).filter((f) => !f.startsWith("."));

      for (const file of files) {
        const stat = fs.statSync(path.join(releaseDir, file));
        if (stat.isFile()) {
          const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
          log.step(file, `${sizeMB} MB`);
        }
      }
    }
  } else {
    log.step("Bundled files", `.deskpack${path.sep}desktop${path.sep}server`);
    log.dim("  Run without --skip-package to create installers");
  }

  log.blank();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function recoverStaleTopology(
  rootDir: string,
  config: DeskpackConfig,
): DeskpackConfig {
  if (config.topology !== "backend-serves-frontend") {
    return config;
  }

  const { topology, evidence } = detectTopology(
    rootDir,
    config.backend.path,
    config.backend.entry,
    config.frontend.path,
    config.frontend.framework,
    config.frontend.distDir,
    config.frontend.tanstackStart ?? null,
    config.frontend.nextRuntime ?? null,
  );

  if (topology !== "frontend-static-separate") {
    return config;
  }

  log.info("Recovered topology: frontend-static-separate");
  return {
    ...config,
    topology,
    topologyEvidence: evidence,
  };
}

function warnWindowsNativeRuntimePrerequisite(
  config: DeskpackConfig,
  targetPlatform: NodeJS.Platform,
): void {
  if (targetPlatform !== "win32") return;
  if (config.backend.nativeDeps.length === 0) return;

  log.warn(
    "Windows users may need Microsoft Visual C++ Redistributable 2015-2022 x64 for native dependencies.",
  );
  log.dim("  Install from https://aka.ms/vc14/vc_redist.x64.exe");
}
