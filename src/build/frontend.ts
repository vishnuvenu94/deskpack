import fs from "node:fs";
import path from "node:path";
import type { DeskpackConfig } from "../types.js";
import { execPassthrough, resolvePlatformCommand } from "../utils/exec.js";
import { log } from "../utils/logger.js";

/**
 * Build the frontend by running the project's existing build command
 * through the detected package manager.
 */
export async function buildFrontend(
  rootDir: string,
  config: DeskpackConfig,
): Promise<void> {
  const pm = config.monorepo.packageManager;
  const pmCommand = resolvePlatformCommand(pm);
  let command: string;
  let args: string[];

  if (config.monorepo.type !== "none") {
    // Monorepo: run the build through the workspace-aware package manager.
    const pkgJsonPath = path.join(rootDir, config.frontend.path, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));

    command = pmCommand;

    if (pm === "pnpm") {
      args = ["--filter", pkg.name as string, "run", "build"];
    } else if (pm === "yarn") {
      args = ["workspace", pkg.name as string, "run", "build"];
    } else {
      args = ["--workspace", config.frontend.path, "run", "build"];
    }
  } else {
    // Single package: run build from the frontend directory
    command = pmCommand;
    if (config.frontend.path === ".") {
      args = ["run", "build"];
    } else {
      // Frontend in subdirectory - run from that directory
      args = ["run", "--prefix", config.frontend.path, "build"];
    }
  }

  log.step("Building frontend", `${command} ${args.join(" ")}`);

  const exitCode = await execPassthrough(command, args, { cwd: rootDir });

  if (exitCode !== 0) {
    throw new Error(`Frontend build failed with exit code ${exitCode}`);
  }

  log.success("Frontend built");
}
