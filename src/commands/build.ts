import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { buildFrontend } from "../build/frontend.js";
import { bundleBackend } from "../build/backend.js";
import { copyRuntimeDependencies } from "../build/runtime-deps.js";
import { packageElectron } from "../build/package.js";
import {
  inspectPlatformBuild,
  normalizeBuildPlatform,
  platformLabel,
} from "../build/platform.js";
import { generateElectronMain } from "../generate/electron-main.js";
import { loadConfig } from "../config.js";
import { log } from "../utils/logger.js";

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
  const config = loadConfig(rootDir);
  const targetPlatform = normalizeBuildPlatform(options.platform);

  if (config.topology === "ssr-framework") {
    throw new Error(
      "Next.js SSR/server runtime projects are not supported. Use static export (output: \"export\") before building.",
    );
  }

  if (config.topology === "unsupported") {
    throw new Error(
      "Unsupported topology. Deskpack could not determine a reliable frontend/backend runtime layout.",
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

  // 2. Copy built frontend to server bundle ---------------------------------
  let frontendDistPath = path.resolve(rootDir, config.frontend.distDir);

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
  if (config.topology === "frontend-only-static" || config.backend.path === "") {
    log.success("No backend detected; skipping backend bundle");
  } else {
    await bundleBackend(rootDir, config, serverDir);
    copyRuntimeDependencies(rootDir, config, serverDir);
  }

  // 4. Regenerate Electron main (in case config changed) --------------------
  fs.writeFileSync(
    path.join(desktopDir, "main.cjs"),
    generateElectronMain(config),
  );

  // 5. Package (optional) ---------------------------------------------------
  if (!options.skipPackage) {
    log.blank();
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
