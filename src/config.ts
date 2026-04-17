import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import type { ShipdeskConfig } from "./types.js";
import { detectTopology } from "./detect/topology.js";

/**
 * Load and parse the `shipdesk.config.json` from the project root.
 * Exits with a helpful error message if the file does not exist.
 */
export function loadConfig(rootDir: string): ShipdeskConfig {
  const configPath = path.join(rootDir, "shipdesk.config.json");

  if (!fs.existsSync(configPath)) {
    console.error(
      `${chalk.red("✗")} No shipdesk.config.json found. Run ${chalk.cyan("npx shipdesk init")} first.`,
    );
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Partial<ShipdeskConfig>;

  if (!raw.topology && raw.frontend && raw.backend) {
    const { topology, evidence } = detectTopology(
      rootDir,
      raw.backend.path,
      raw.backend.entry,
      raw.frontend.path,
      raw.frontend.framework,
      raw.frontend.distDir,
    );

    raw.topology = topology;
    raw.topologyEvidence = evidence;
  }

  raw.topologyEvidence ??= {
    staticServingPatterns: [],
    ssrPatterns: [],
    staticRoot: null,
    frontendDistFound: false,
    warnings: [],
  };

  return raw as ShipdeskConfig;
}
