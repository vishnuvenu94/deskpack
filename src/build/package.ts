import fs from "node:fs";
import path from "node:path";
import { execPassthrough } from "../utils/exec.js";
import { log } from "../utils/logger.js";

/**
 * Run `electron-builder` inside the `.shipdesk/desktop/` directory to
 * produce platform-specific installers.
 */
export async function packageElectron(rootDir: string): Promise<void> {
  const desktopDir = path.join(rootDir, ".shipdesk", "desktop");

  if (
    !fs.existsSync(path.join(desktopDir, "node_modules", "electron"))
  ) {
    throw new Error(
      "Electron is not installed. Run `shipdesk init` first.",
    );
  }

  log.step("Packaging application", "electron-builder");

  const exitCode = await execPassthrough(
    "npx",
    ["electron-builder", "--config", "electron-builder.yml"],
    { cwd: desktopDir },
  );

  if (exitCode !== 0) {
    throw new Error(`electron-builder failed with exit code ${exitCode}`);
  }

  const releaseDir = path.join(rootDir, ".shipdesk", "release");
  log.success(`Packaged → ${path.relative(rootDir, releaseDir)}/`);
}
