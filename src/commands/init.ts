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
import type { ShipdeskConfig } from "../types.js";

/**
 * `shipdesk init`
 *
 * 1. Detect the project structure.
 * 2. Confirm settings with the user.
 * 3. Generate Electron shell files in `.shipdesk/desktop/`.
 * 4. Install Electron.
 */
export async function initCommand(rootDir: string): Promise<void> {
  log.banner();
  log.info("Scanning project…");
  log.blank();

  // --- Detection -----------------------------------------------------------
  const project = detectProject(rootDir);

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
    "Backend": `${project.backend.framework} (${project.backend.path})`,
    "Frontend port": String(project.frontend.devPort),
    "Backend port": String(project.backend.devPort),
  });

  if (project.topologyEvidence.staticServingPatterns.length > 0) {
    log.blank();
    log.dim("  Static serving patterns found:");
    for (const p of project.topologyEvidence.staticServingPatterns.slice(0, 3)) {
      log.dim(`    - ${p}`);
    }
  }

  if (project.topologyEvidence.warnings.length > 0) {
    log.blank();
    for (const w of project.topologyEvidence.warnings) {
      log.warn(w);
    }
  }

  if (project.backend.nativeDeps.length > 0) {
    log.blank();
    log.warn(
      `Native dependencies: ${project.backend.nativeDeps.join(", ")}`,
    );
    log.dim("  These will be kept external during bundling.");
  }

  log.blank();

  // --- User confirmation ---------------------------------------------------
  const response = await prompts([
    {
      type: "text",
      name: "name",
      message: "App name",
      initial: toTitleCase(project.name),
    },
    {
      type: "text",
      name: "appId",
      message: "App ID",
      initial: project.appId,
      validate: (value: string) =>
        /^[a-zA-Z][a-zA-Z0-9.]*$/.test(value) && value.split(".").length >= 2
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

  // --- Build config --------------------------------------------------------
  const config: ShipdeskConfig = {
    name: response.name ?? project.name,
    appId: response.appId ?? project.appId,
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

  // --- Generate files ------------------------------------------------------
  const shipdeskDir = path.join(rootDir, ".shipdesk");
  const desktopDir = path.join(shipdeskDir, "desktop");
  fs.mkdirSync(desktopDir, { recursive: true });

  // shipdesk.config.json
  const configPath = path.join(rootDir, "shipdesk.config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  log.success(`Created ${chalk.cyan("shipdesk.config.json")}`);

  // Electron main process
  fs.writeFileSync(
    path.join(desktopDir, "main.cjs"),
    generateElectronMain(config),
  );
  log.success(`Created ${chalk.cyan(".shipdesk/desktop/main.cjs")}`);

  // electron-builder config
  fs.writeFileSync(
    path.join(desktopDir, "electron-builder.yml"),
    generateElectronBuilderConfig(config),
  );
  log.success(`Created ${chalk.cyan(".shipdesk/desktop/electron-builder.yml")}`);

  // Desktop package.json
  fs.writeFileSync(
    path.join(desktopDir, "package.json"),
    generateDesktopPackageJson(config),
  );
  log.success(`Created ${chalk.cyan(".shipdesk/desktop/package.json")}`);

  // --- Update .gitignore ---------------------------------------------------
  const gitignorePath = path.join(rootDir, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf-8");
    if (!content.includes(".shipdesk")) {
      fs.appendFileSync(gitignorePath, "\n# shipdesk\n.shipdesk/\nshipdesk.config.json\n");
      log.success("Updated .gitignore");
    }
  }

  // --- Install Electron ----------------------------------------------------
  log.blank();
  const spinner = log.spinner(
    "Installing Electron (this may take a moment)…",
  );

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

  // --- Done ----------------------------------------------------------------
  log.blank();
  log.success(chalk.bold("Desktop configuration ready!"));
  log.blank();
  log.info("Next steps:");
  log.step(
    `Run ${chalk.cyan("npx shipdesk dev")} to launch in dev mode`,
  );
  log.step(
    `Run ${chalk.cyan("npx shipdesk build")} to create a distributable`,
  );
  log.blank();
}

function toTitleCase(str: string): string {
  return str
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
