import fs from "node:fs";
import path from "node:path";
import type { DeskpackConfig } from "../types.js";
import { log } from "../utils/logger.js";

export function copyDatabaseAssets(
  rootDir: string,
  config: DeskpackConfig,
  serverDir: string,
): void {
  if (!config.database) return;

  const destination = path.join(serverDir, "database");
  fs.mkdirSync(destination, { recursive: true });

  if (config.database.templatePath) {
    const source = path.resolve(rootDir, config.database.templatePath);
    if (!fs.existsSync(source)) {
      throw new Error(`Configured SQLite template database not found at ${source}.`);
    }
    fs.copyFileSync(source, path.join(destination, "template.db"));
  }

  const migrations = config.database.migrations;
  if (migrations?.path) {
    const source = path.resolve(rootDir, migrations.path);
    if (fs.existsSync(source)) {
      copyDirSync(source, path.join(destination, "migrations"));
    }
  }

  log.success(`Prepared SQLite database assets -> ${path.relative(rootDir, destination)}`);
}

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
