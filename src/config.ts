import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import type { DeskpackConfig } from "./types.js";
import { detectTopology } from "./detect/topology.js";

const APP_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9.]*$/;
const FRONTEND_FRAMEWORKS = new Set(["vite", "next", "cra", "angular", "webpack", "parcel", "unknown"]);
const BACKEND_FRAMEWORKS = new Set(["express", "hono", "fastify", "koa", "nestjs", "http", "unknown"]);
const TOPOLOGIES = new Set([
  "backend-serves-frontend",
  "frontend-static-separate",
  "frontend-only-static",
  "next-standalone-runtime",
  "ssr-framework",
  "unsupported",
]);
const MONOREPO_TYPES = new Set(["pnpm", "yarn", "npm", "lerna", "nx", "turbo", "none"]);
const PACKAGE_MANAGERS = new Set(["pnpm", "yarn", "npm"]);

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

  const raw = parseConfigFile(configPath);

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
      raw.frontend.nextRuntime ?? null,
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

  return validateConfig(rootDir, raw);
}

function parseConfigFile(configPath: string): Partial<DeskpackConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (error) {
    throw new Error(
      `Failed to parse deskpack.config.json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(parsed)) {
    throw new Error("Invalid deskpack.config.json: expected a JSON object at the root.");
  }

  return parsed as Partial<DeskpackConfig>;
}

function validateConfig(
  rootDir: string,
  raw: Partial<DeskpackConfig>,
): DeskpackConfig {
  const name = readString(raw.name, "name");
  const version = readString(raw.version, "version");
  const appId = readString(raw.appId, "appId");
  if (!APP_ID_PATTERN.test(appId) || appId.split(".").length < 2) {
    fail(`appId "${appId}" is invalid. Expected format like "com.example.app".`);
  }

  const frontendRaw = expectRecord(raw.frontend, "frontend");
  const frontendPath = validateProjectRelativePath(rootDir, readString(frontendRaw.path, "frontend.path"), "frontend.path");
  const frontendFramework = readEnum(
    frontendRaw.framework,
    "frontend.framework",
    FRONTEND_FRAMEWORKS,
  );
  const frontendBuildCommand = readString(frontendRaw.buildCommand, "frontend.buildCommand");
  const frontendDistDir = validateProjectRelativePath(
    rootDir,
    readString(frontendRaw.distDir, "frontend.distDir"),
    "frontend.distDir",
  );
  const frontendDevPort = readPort(frontendRaw.devPort, "frontend.devPort", false);
  const tanstackStart = readTanstackStart(frontendRaw.tanstackStart);
  const nextRuntime = readNextRuntime(rootDir, frontendRaw.nextRuntime);

  const backendRaw = expectRecord(raw.backend, "backend");
  const backendPath = validateProjectRelativePath(
    rootDir,
    readString(backendRaw.path, "backend.path", true),
    "backend.path",
    true,
  );
  const backendFramework = readEnum(
    backendRaw.framework,
    "backend.framework",
    BACKEND_FRAMEWORKS,
  );

  const backendEntry = backendPath
    ? validateProjectRelativePath(
        rootDir,
        readString(backendRaw.entry, "backend.entry"),
        "backend.entry",
      )
    : "";
  const backendDevPort = readPort(backendRaw.devPort, "backend.devPort", backendPath.length === 0);
  const backendNativeDeps = readStringArray(backendRaw.nativeDeps, "backend.nativeDeps");

  const healthCheckPath = normalizeApiPath(
    readString(backendRaw.healthCheckPath ?? "/", "backend.healthCheckPath"),
    "backend.healthCheckPath",
  );
  const apiPrefixes = readApiPrefixes(backendRaw.apiPrefixes);
  const proxyRewrite = readOptionalApiPath(backendRaw.proxyRewrite, "backend.proxyRewrite");

  const monorepoRaw = expectRecord(raw.monorepo, "monorepo");
  const monorepoType = readEnum(monorepoRaw.type, "monorepo.type", MONOREPO_TYPES);
  const packageManager = readEnum(
    monorepoRaw.packageManager,
    "monorepo.packageManager",
    PACKAGE_MANAGERS,
  );

  const topology = readEnum(raw.topology, "topology", TOPOLOGIES);
  const topologyEvidence = readTopologyEvidence(raw.topologyEvidence);

  const electronRaw = expectRecord(raw.electron, "electron");
  const windowRaw = expectRecord(electronRaw.window, "electron.window");
  const windowWidth = readPositiveInteger(windowRaw.width, "electron.window.width");
  const windowHeight = readPositiveInteger(windowRaw.height, "electron.window.height");

  return {
    name,
    appId,
    version,
    frontend: {
      path: frontendPath,
      framework: frontendFramework as DeskpackConfig["frontend"]["framework"],
      buildCommand: frontendBuildCommand,
      distDir: frontendDistDir,
      devPort: frontendDevPort,
      ...(tanstackStart ? { tanstackStart } : {}),
      ...(nextRuntime ? { nextRuntime } : {}),
    },
    backend: {
      path: backendPath,
      framework: backendFramework as DeskpackConfig["backend"]["framework"],
      entry: backendEntry,
      devPort: backendDevPort,
      nativeDeps: backendNativeDeps,
      startCommand: readOptionalString(backendRaw.startCommand, "backend.startCommand"),
      cwd: readOptionalString(backendRaw.cwd, "backend.cwd"),
      healthCheckPath,
      apiPrefixes,
      ...(proxyRewrite ? { proxyRewrite } : {}),
    },
    monorepo: {
      type: monorepoType as DeskpackConfig["monorepo"]["type"],
      packageManager: packageManager as DeskpackConfig["monorepo"]["packageManager"],
    },
    topology: topology as DeskpackConfig["topology"],
    topologyEvidence,
    electron: {
      window: { width: windowWidth, height: windowHeight },
    },
  };
}

function readNextRuntime(
  rootDir: string,
  value: unknown,
): DeskpackConfig["frontend"]["nextRuntime"] {
  if (value === undefined) return undefined;
  const raw = expectRecord(value, "frontend.nextRuntime");
  return {
    mode: readEnum(
      raw.mode,
      "frontend.nextRuntime.mode",
      new Set(["static-export", "standalone", "unsupported"]),
    ) as NonNullable<DeskpackConfig["frontend"]["nextRuntime"]>["mode"],
    standaloneDir: validateProjectRelativePath(
      rootDir,
      readString(raw.standaloneDir, "frontend.nextRuntime.standaloneDir"),
      "frontend.nextRuntime.standaloneDir",
    ),
    serverFile: validateProjectRelativePath(
      rootDir,
      readString(raw.serverFile, "frontend.nextRuntime.serverFile"),
      "frontend.nextRuntime.serverFile",
    ),
    staticDir: validateProjectRelativePath(
      rootDir,
      readString(raw.staticDir, "frontend.nextRuntime.staticDir"),
      "frontend.nextRuntime.staticDir",
    ),
    publicDir: validateProjectRelativePath(
      rootDir,
      readString(raw.publicDir, "frontend.nextRuntime.publicDir"),
      "frontend.nextRuntime.publicDir",
    ),
    warnings: readStringArray(raw.warnings, "frontend.nextRuntime.warnings"),
  };
}

function readTanstackStart(value: unknown): DeskpackConfig["frontend"]["tanstackStart"] {
  if (value === undefined) return undefined;
  const raw = expectRecord(value, "frontend.tanstackStart");
  return {
    isConfirmed: readBoolean(raw.isConfirmed, "frontend.tanstackStart.isConfirmed"),
    spaEnabled: readBoolean(raw.spaEnabled, "frontend.tanstackStart.spaEnabled"),
    prerenderEnabled: readBoolean(raw.prerenderEnabled, "frontend.tanstackStart.prerenderEnabled"),
    ineligibilityReasons: readStringArray(
      raw.ineligibilityReasons,
      "frontend.tanstackStart.ineligibilityReasons",
    ),
  };
}

function readTopologyEvidence(
  value: unknown,
): DeskpackConfig["topologyEvidence"] {
  const raw = expectRecord(value, "topologyEvidence");
  const staticRoot = raw.staticRoot;
  if (staticRoot !== null && typeof staticRoot !== "string") {
    fail("topologyEvidence.staticRoot must be a string or null.");
  }

  return {
    staticServingPatterns: readStringArray(
      raw.staticServingPatterns,
      "topologyEvidence.staticServingPatterns",
    ),
    ssrPatterns: readStringArray(raw.ssrPatterns, "topologyEvidence.ssrPatterns"),
    staticRoot,
    frontendDistFound: readBoolean(
      raw.frontendDistFound,
      "topologyEvidence.frontendDistFound",
    ),
    warnings: readStringArray(raw.warnings, "topologyEvidence.warnings"),
  };
}

function readString(
  value: unknown,
  field: string,
  allowEmpty = false,
): string {
  if (typeof value !== "string") {
    fail(`${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) {
    fail(`${field} must not be empty.`);
  }
  return trimmed;
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return readString(value, field, true);
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    fail(`${field} must be a boolean.`);
  }
  return value;
}

function readPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    fail(`${field} must be a positive integer.`);
  }
  return value;
}

function readPort(value: unknown, field: string, allowZero: boolean): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(`${field} must be an integer.`);
  }
  if (allowZero && value === 0) return 0;
  if (value < 1 || value > 65535) {
    fail(`${field} must be between 1 and 65535${allowZero ? " (or 0 when no backend is used)" : ""}.`);
  }
  return value;
}

function readEnum(value: unknown, field: string, allowed: Set<string>): string {
  const str = readString(value, field);
  if (!allowed.has(str)) {
    fail(`${field} has unsupported value "${str}".`);
  }
  return str;
}

function readStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    fail(`${field} must be an array of strings.`);
  }

  return value.map((entry, index) => {
    const str = readString(entry, `${field}[${index}]`);
    if (str.includes("\u0000")) {
      fail(`${field}[${index}] contains invalid characters.`);
    }
    return str;
  });
}

function readApiPrefixes(value: unknown): string[] {
  if (value === undefined) return ["/api"];
  const prefixes = readStringArray(value, "backend.apiPrefixes");
  if (prefixes.length === 0) {
    fail("backend.apiPrefixes must include at least one prefix.");
  }
  return prefixes.map((prefix, index) =>
    normalizeApiPath(prefix, `backend.apiPrefixes[${index}]`),
  );
}

function readOptionalApiPath(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return normalizeApiPath(readString(value, field), field);
}

function normalizeApiPath(value: string, field: string): string {
  if (!value.startsWith("/")) {
    fail(`${field} must start with "/".`);
  }
  if (value.includes(" ")) {
    fail(`${field} must not contain whitespace.`);
  }
  return value;
}

function validateProjectRelativePath(
  rootDir: string,
  value: string,
  field: string,
  allowEmpty = false,
): string {
  if (allowEmpty && value.length === 0) {
    return value;
  }
  if (path.isAbsolute(value)) {
    fail(`${field} must be relative to the project root.`);
  }
  if (value.includes("\u0000")) {
    fail(`${field} contains invalid characters.`);
  }

  const resolved = path.resolve(rootDir, value);
  if (!isWithinRoot(rootDir, resolved)) {
    fail(`${field} resolves outside the project root.`);
  }

  return value;
}

function isWithinRoot(rootDir: string, targetPath: string): boolean {
  const normalizedRoot = path.resolve(rootDir);
  const withSep = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : normalizedRoot + path.sep;
  return targetPath === normalizedRoot || targetPath.startsWith(withSep);
}

function expectRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    fail(`${field} must be an object.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(`Invalid deskpack.config.json: ${message}`);
}
