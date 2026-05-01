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
  assertFrontendBuildDependencies(rootDir, config);
  let command: string;
  let args: string[];
  let cwd = rootDir;

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
      // Frontend in subdirectory: run from that package so npm exposes
      // its local node_modules/.bin on PATH consistently on Windows.
      cwd = path.resolve(rootDir, config.frontend.path);
      args = ["run", "build"];
    }
  }

  const extraBuildArgs = frontendBuildScriptArgs(config);
  if (extraBuildArgs.length > 0) {
    args = appendPackageScriptArgs(pm, args, extraBuildArgs);
    log.info(
      "Using Next.js Webpack build on Windows because native runtime dependencies are present.",
    );
  }

  log.step("Building frontend", `${command} ${args.join(" ")}`);

  const exitCode = await execPassthrough(command, args, { cwd });

  if (exitCode !== 0) {
    throw new Error(`Frontend build failed with exit code ${exitCode}`);
  }

  log.success("Frontend built");
}

export function frontendBuildScriptArgs(
  config: DeskpackConfig,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform !== "win32") return [];
  if (config.frontend.framework !== "next") return [];
  if (config.backend.nativeDeps.length === 0) return [];

  const buildCommand = config.frontend.buildCommand.trim();
  if (!/^next(?:\.(?:cmd|exe|bat|com))?\s+build(?:\s|$)/i.test(buildCommand)) {
    return [];
  }
  if (/(^|\s)--(?:webpack|turbopack|turbo)(\s|$)/i.test(buildCommand)) {
    return [];
  }

  return ["--webpack"];
}

function appendPackageScriptArgs(
  packageManager: DeskpackConfig["monorepo"]["packageManager"],
  args: string[],
  extraArgs: string[],
): string[] {
  if (packageManager === "yarn") {
    return [...args, ...extraArgs];
  }

  return [...args, "--", ...extraArgs];
}

function assertFrontendBuildDependencies(
  rootDir: string,
  config: DeskpackConfig,
): void {
  const requiredBin = requiredBuildBinary(config.frontend.buildCommand);
  if (!requiredBin) return;

  const frontendDir = path.resolve(rootDir, config.frontend.path);
  if (hasLocalBin(rootDir, frontendDir, requiredBin)) return;

  throw new Error(
    `Frontend build tool "${requiredBin}" was not found in node_modules. ` +
      `Install project dependencies first: ${installCommand(config)}`,
  );
}

function requiredBuildBinary(buildCommand: string): string | null {
  const command = buildCommand.trim();
  if (!command) return null;

  for (const binary of ["vite", "next", "react-scripts", "ng", "webpack", "parcel"]) {
    const pattern = new RegExp(`(^|[\\s;&|])${escapeRegExp(binary)}(\\.(cmd|exe|bat|com))?([\\s;&|]|$)`);
    if (pattern.test(command)) return binary;
  }

  return null;
}

function hasLocalBin(rootDir: string, packageDir: string, command: string): boolean {
  let current = packageDir;
  const stopAt = path.dirname(rootDir);

  while (current.startsWith(rootDir) && current !== stopAt) {
    if (fs.existsSync(resolveLocalBinForAnyPlatform(current, command))) {
      return true;
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return false;
}

function resolveLocalBinForAnyPlatform(packageDir: string, command: string): string {
  const binDir = path.join(packageDir, "node_modules", ".bin");
  const platformBin = resolvePlatformCommand(command);
  const candidates = [
    path.join(binDir, platformBin),
    path.join(binDir, command),
    path.join(binDir, `${command}.cmd`),
    path.join(binDir, `${command}.exe`),
    path.join(binDir, `${command}.bat`),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function installCommand(config: DeskpackConfig): string {
  const pm = config.monorepo.packageManager;

  if (config.monorepo.type !== "none") {
    return `${pm} install`;
  }

  if (config.frontend.path === ".") {
    return `${pm} install`;
  }

  if (pm === "npm") {
    return `npm install --prefix ${config.frontend.path}`;
  }

  if (pm === "pnpm") {
    return `pnpm install --dir ${config.frontend.path}`;
  }

  return `cd ${config.frontend.path} && yarn install`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
