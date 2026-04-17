import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { buildFrontend } from "../build/frontend.js";
import { bundleBackend } from "../build/backend.js";
import { copyRuntimeDependencies } from "../build/runtime-deps.js";
import { packageElectron } from "../build/package.js";
import { generateElectronMain } from "../generate/electron-main.js";
import { loadConfig } from "../config.js";
import { log } from "../utils/logger.js";

/**
 * `shipdesk build`
 *
 * 1. Build the frontend.
 * 2. Bundle the backend with esbuild.
 * 3. Copy the built frontend into the server bundle.
 * 4. Regenerate the Electron main process.
 * 5. (Optional) Run electron-builder to create installers.
 */
export async function buildCommand(
  rootDir: string,
  options: { skipPackage?: boolean },
): Promise<void> {
  log.banner();
  const config = loadConfig(rootDir);

  const desktopDir = path.join(rootDir, ".shipdesk", "desktop");
  const serverDir = path.join(desktopDir, "server");

  if (!fs.existsSync(path.join(desktopDir, "node_modules", "electron"))) {
    log.error(
      `Desktop not initialised. Run ${chalk.cyan("npx shipdesk init")} first.`,
    );
    process.exit(1);
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

  // 2. Copy built frontend to server bundle ---------------------------------
  const frontendDistPath = path.resolve(rootDir, config.frontend.distDir);
  if (!fs.existsSync(frontendDistPath)) {
    throw new Error(
      `Frontend dist not found at ${frontendDistPath}. Did the build succeed?`,
    );
  }

  copyDirSync(frontendDistPath, path.join(serverDir, "web-dist"));

  // Preserve the original dist path inside the server runtime as well. Many
  // backends resolve static assets relative to process.cwd() or import.meta.url
  // using paths like apps/web/dist rather than a generic web-dist directory.
  const preservedFrontendDistPath = path.join(serverDir, config.frontend.distDir);
  if (path.resolve(preservedFrontendDistPath) !== path.resolve(path.join(serverDir, "web-dist"))) {
    copyDirSync(frontendDistPath, preservedFrontendDistPath);
  }
  log.success("Copied frontend build to server bundle");

  // 3. Bundle backend -------------------------------------------------------
  await bundleBackend(rootDir, config, serverDir);
  copyRuntimeDependencies(rootDir, config, serverDir);

  // 4. Regenerate Electron main (in case config changed) --------------------
  fs.writeFileSync(
    path.join(desktopDir, "main.cjs"),
    generateElectronMain(config),
  );

  // 5. Package (optional) ---------------------------------------------------
  if (!options.skipPackage) {
    log.blank();
    await packageElectron(rootDir);
  }

  // --- Summary -------------------------------------------------------------
  log.blank();
  log.success(chalk.bold("Build complete!"));

  if (!options.skipPackage) {
    const releaseDir = path.join(rootDir, ".shipdesk", "release");
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
    log.step("Bundled files", `.shipdesk${path.sep}desktop${path.sep}server`);
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
