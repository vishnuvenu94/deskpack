import fs from "node:fs";
import path from "node:path";
import prompts from "prompts";
import chalk from "chalk";
import { detectProject } from "../detect/index.js";
import { generateElectronMain } from "../generate/electron-main.js";
import { generateElectronBuilderConfig } from "../generate/electron-config.js";
import { generateDesktopPackageJson } from "../generate/package-json.js";
import { topologyDescription } from "../detect/topology.js";
import { exec } from "../utils/exec.js";
import { log } from "../utils/logger.js";
import type { DeskpackConfig } from "../types.js";

export interface InitCommandOptions {
  yes?: boolean;
  name?: string;
  appId?: string;
  force?: boolean;
}

const APP_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9.]*$/;

/**
 * `deskpack init`
 *
 * 1. Detect the project structure.
 * 2. Confirm settings with the user.
 * 3. Generate Electron shell files in `.deskpack/desktop/`.
 * 4. Install Electron.
 */
export async function initCommand(
  rootDir: string,
  options: InitCommandOptions = {},
): Promise<void> {
  log.banner();
  log.info("Scanning project…");
  log.blank();

  const project = detectProject(rootDir);
  const hasBackend = project.backend.path.length > 0;

  log.info("Detected project structure:");
  log.blank();
  log.table({
    "Project": project.name,
    "Topology": topologyDescription(project.topology),
    "Monorepo":
      project.monorepo.type === "none"
        ? "No"
        : `${project.monorepo.type} (${project.monorepo.packageManager})`,
    "Frontend": `${project.frontend.uiLibrary} + ${project.frontend.framework} (${project.frontend.path})`,
    "Backend": hasBackend
      ? `${project.backend.framework} (${project.backend.path})`
      : "No",
    "Frontend port": String(project.frontend.devPort),
    "Backend port": hasBackend ? String(project.backend.devPort) : "n/a",
  });

  if (project.topologyEvidence.staticServingPatterns.length > 0) {
    log.blank();
    log.dim("  Static serving patterns found:");
    for (const pattern of project.topologyEvidence.staticServingPatterns.slice(0, 3)) {
      log.dim(`    - ${pattern}`);
    }
  }

  if (project.topologyEvidence.warnings.length > 0) {
    log.blank();
    for (const warning of project.topologyEvidence.warnings) {
      log.warn(warning);
    }
  }

  if (hasBackend && project.backend.nativeDeps.length > 0) {
    log.blank();
    log.warn(`Native dependencies: ${project.backend.nativeDeps.join(", ")}`);
    log.dim("  These will be kept external during bundling.");
  }

  if (project.topology === "ssr-framework") {
    throw new Error(
      "Next.js SSR/server runtime projects are not supported. Configure static export (output: \"export\") and run init again.",
    );
  }

  if (project.topology === "unsupported") {
    throw new Error(
      "Could not determine a supported project topology. Ensure your backend serves frontend assets or export the frontend as static files.",
    );
  }

  const deskpackDir = path.join(rootDir, ".deskpack");
  const desktopDir = path.join(deskpackDir, "desktop");
  const configPath = path.join(rootDir, "deskpack.config.json");
  const hasExistingConfig = fs.existsSync(configPath);
  const hasExistingDesktop = fs.existsSync(desktopDir);

  if (!options.force && (hasExistingConfig || hasExistingDesktop)) {
    throw new Error(
      `Deskpack files already exist. Re-run with ${chalk.cyan("--force")} to overwrite ${chalk.cyan("deskpack.config.json")} and ${chalk.cyan(".deskpack/desktop")}.`,
    );
  }

  const defaultName = (options.name?.trim() || toTitleCase(project.name)).trim();
  const defaultAppId = (options.appId?.trim() || project.appId).trim();

  if (!isValidAppId(defaultAppId)) {
    throw new Error(
      `Invalid app ID "${defaultAppId}". Expected format like ${chalk.cyan("com.example.app")}.`,
    );
  }

  log.blank();

  const response = options.yes
    ? { name: defaultName, appId: defaultAppId, proceed: true }
    : await prompts([
        {
          type: "text",
          name: "name",
          message: "App name",
          initial: defaultName,
          validate: (value: string) =>
            value.trim().length > 0 ? true : "App name is required",
        },
        {
          type: "text",
          name: "appId",
          message: "App ID",
          initial: defaultAppId,
          validate: (value: string) =>
            isValidAppId(value)
              ? true
              : "Must be like com.example.app (starts with letter, alphanumeric + dots, minimum 2 segments)",
        },
        {
          type: "confirm",
          name: "proceed",
          message: "Create desktop configuration?",
          initial: true,
        },
      ]);

  if (!response.proceed) {
    log.info("Cancelled.");
    return;
  }

  const config: DeskpackConfig = {
    name: String(response.name).trim(),
    appId: String(response.appId).trim(),
    version: project.version,
    frontend: {
      path: project.frontend.path,
      framework: project.frontend.framework,
      buildCommand: project.frontend.buildCommand,
      distDir: project.frontend.distDir,
      devPort: project.frontend.devPort,
    },
    backend: {
      path: project.backend.path,
      framework: project.backend.framework,
      entry: project.backend.entry,
      devPort: project.backend.devPort,
      nativeDeps: project.backend.nativeDeps,
      startCommand: project.backend.startCommand,
      cwd: project.backend.cwd,
      healthCheckPath: project.backend.healthCheckPath ?? "/",
    },
    monorepo: {
      type: project.monorepo.type,
      packageManager: project.monorepo.packageManager,
    },
    topology: project.topology,
    topologyEvidence: project.topologyEvidence,
    electron: {
      window: { width: 1280, height: 860 },
    },
  };

  if (options.force && fs.existsSync(desktopDir)) {
    fs.rmSync(desktopDir, { recursive: true, force: true });
  }
  fs.mkdirSync(desktopDir, { recursive: true });

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  log.success(`Created ${chalk.cyan("deskpack.config.json")}`);

  fs.writeFileSync(
    path.join(desktopDir, "main.cjs"),
    generateElectronMain(config),
  );
  log.success(`Created ${chalk.cyan(".deskpack/desktop/main.cjs")}`);

  fs.writeFileSync(
    path.join(desktopDir, "electron-builder.yml"),
    generateElectronBuilderConfig(config),
  );
  log.success(`Created ${chalk.cyan(".deskpack/desktop/electron-builder.yml")}`);

  fs.writeFileSync(
    path.join(desktopDir, "package.json"),
    generateDesktopPackageJson(config),
  );
  log.success(`Created ${chalk.cyan(".deskpack/desktop/package.json")}`);

  const gitignorePath = path.join(rootDir, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf-8");
    if (!content.includes(".deskpack/")) {
      fs.appendFileSync(
        gitignorePath,
        "\n# deskpack\n.deskpack/\ndeskpack.config.json\n",
      );
      log.success("Updated .gitignore");
    }
  }

  log.blank();
  if (process.env.DESKPACK_SKIP_ELECTRON_INSTALL === "1") {
    log.warn("Skipping Electron install (DESKPACK_SKIP_ELECTRON_INSTALL=1).");
  } else {
    const spinner = log.spinner("Installing Electron (this may take a moment)…");
    try {
      const result = await exec("npm", ["install"], { cwd: desktopDir });
      if (result.exitCode !== 0) {
        spinner.fail("Failed to install Electron");
        log.dim(result.stderr);
        throw new Error("npm install failed");
      }
      spinner.succeed("Electron installed");
    } catch (error) {
      spinner.fail("Failed to install Electron");
      throw error;
    }
  }

  log.blank();
  log.success(chalk.bold("Desktop configuration ready!"));
  log.blank();
  log.info("Next steps:");
  log.step(`Run ${chalk.cyan("npx deskpack dev")} to launch in dev mode`);
  log.step(`Run ${chalk.cyan("npx deskpack build")} to create a distributable`);
  log.blank();
}

function toTitleCase(str: string): string {
  return str
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isValidAppId(value: string): boolean {
  return APP_ID_PATTERN.test(value) && value.split(".").length >= 2;
}
