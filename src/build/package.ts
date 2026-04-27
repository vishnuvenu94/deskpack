import fs from "node:fs";
import path from "node:path";
import { execPassthrough } from "../utils/exec.js";
import { log } from "../utils/logger.js";
import type { BuildPlatform } from "../types.js";

/**
 * Run `electron-builder` inside the `.deskpack/desktop/` directory to
 * produce platform-specific installers.
 */
export async function packageElectron(
  rootDir: string,
  targetPlatform: BuildPlatform,
): Promise<void> {
  const desktopDir = path.join(rootDir, ".deskpack", "desktop");

  if (
    !fs.existsSync(path.join(desktopDir, "node_modules", "electron"))
  ) {
    throw new Error(
      "Electron is not installed. Run `deskpack init` first.",
    );
  }

  const platformFlag = electronBuilderPlatformFlag(targetPlatform);
  log.step("Packaging application", `electron-builder ${platformFlag}`);
  const electronBuilderBin = path.join(
    desktopDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "electron-builder.cmd" : "electron-builder",
  );

  if (!fs.existsSync(electronBuilderBin)) {
    throw new Error("electron-builder binary not found. Run `deskpack init` again.");
  }

  const exitCode = await execPassthrough(
    electronBuilderBin,
    ["--config", "electron-builder.yml", platformFlag],
    { cwd: desktopDir },
  );

  if (exitCode !== 0) {
    throw new Error(`electron-builder failed with exit code ${exitCode}`);
  }

  const releaseDir = path.join(rootDir, ".deskpack", "release");
  log.success(`Packaged → ${path.relative(rootDir, releaseDir)}/`);
}

function electronBuilderPlatformFlag(platform: BuildPlatform): string {
  switch (platform) {
    case "darwin":
      return "--mac";
    case "win32":
      return "--win";
    case "linux":
      return "--linux";
  }
}
