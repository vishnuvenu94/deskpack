import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import type { DeskpackConfig } from "./types.js";
import { detectTopology } from "./detect/topology.js";

/**
 * Load and parse the `deskpack.config.json` from the project root.
 * Exits with a helpful error message if the file does not exist.
 */
export function loadConfig(rootDir: string): DeskpackConfig {
  const configPath = path.join(rootDir, "deskpack.config.json");

  if (!fs.existsSync(configPath)) {
    console.error(
      `${chalk.red("✗")} No deskpack.config.json found. Run ${chalk.cyan("npx deskpack init")} first.`,
    );
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Partial<DeskpackConfig>;

  if (!raw.backend) {
    raw.backend = {
      path: "",
      framework: "unknown",
      entry: "",
      devPort: 0,
      nativeDeps: [],
      healthCheckPath: "/",
    };
  }

  raw.backend.healthCheckPath ??= "/";

  if (!raw.backend.apiPrefixes || raw.backend.apiPrefixes.length === 0) {
    raw.backend.apiPrefixes = ["/api"];
  }

  if (!raw.topology && raw.frontend) {
    const { topology, evidence } = detectTopology(
      rootDir,
      raw.backend.path,
      raw.backend.entry,
      raw.frontend.path,
      raw.frontend.framework,
      raw.frontend.distDir,
      raw.frontend.tanstackStart ?? null,
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

  return raw as DeskpackConfig;
}
