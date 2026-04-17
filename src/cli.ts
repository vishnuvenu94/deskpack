#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { devCommand } from "./commands/dev.js";
import { buildCommand } from "./commands/build.js";
import { log } from "./utils/logger.js";

const MIN_NODE_VERSION = 18;

function checkNodeVersion(): void {
  const [major] = process.version.slice(1).split(".").map(Number);
  if (major < MIN_NODE_VERSION) {
    log.error(
      `shipdesk requires Node.js ${MIN_NODE_VERSION} or later. You are using ${process.version}.`,
    );
    process.exit(1);
  }
}

checkNodeVersion();

const program = new Command();

program
  .name("shipdesk")
  .description(
    "Convert any full-stack JavaScript web app into a cross-platform desktop application.",
  )
  .version("0.1.0");

program
  .command("init")
  .description("Detect project structure and set up desktop configuration")
  .action(async () => {
    try {
      await initCommand(process.cwd());
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command("dev")
  .description("Run the application in desktop development mode")
  .action(async () => {
    try {
      await devCommand(process.cwd());
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program
  .command("build")
  .description("Build the desktop application for distribution")
  .option("--skip-package", "Bundle only — skip creating the installer")
  .action(async (options: { skipPackage?: boolean }) => {
    try {
      await buildCommand(process.cwd(), options);
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Default: run init if no config exists, otherwise show help.
program.action(async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const configPath = path.join(process.cwd(), "shipdesk.config.json");

  if (fs.existsSync(configPath)) {
    program.help();
  } else {
    try {
      await initCommand(process.cwd());
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }
});

program.parse();
