import crossSpawn from "cross-spawn";
import path from "node:path";
import type { ChildProcess, SpawnOptions } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Resolve CLI command names for the current platform.
 * On Windows, package manager binaries are exposed as *.cmd shims.
 */
export function resolvePlatformCommand(command: string): string {
  if (process.platform !== "win32") return command;
  if (/[\\/]/.test(command)) return command;
  if (/\.(cmd|exe|bat|com)$/i.test(command)) return command;
  return `${command}.cmd`;
}

/**
 * Resolve a locally installed package binary from node_modules/.bin.
 */
export function resolveLocalBin(
  packageDir: string,
  command: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const binaryName =
    platform === "win32" && !/\.(cmd|exe|bat|com)$/i.test(command)
      ? `${command}.cmd`
      : command;

  return path.join(packageDir, "node_modules", ".bin", binaryName);
}

/**
 * Spawn a command using Windows-safe npm shim handling.
 */
export function spawnCommand(
  command: string,
  args: string[],
  options?: SpawnOptions,
): ChildProcess {
  return crossSpawn(command, args, {
    shell: false,
    ...options,
  });
}

/**
 * Execute a command, capture its output, and return when it exits.
 */
export function exec(
  command: string,
  args: string[],
  options?: SpawnOptions,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const proc = spawnCommand(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("error", reject);
    proc.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

/**
 * Execute a command with inherited stdio (output goes directly to the terminal).
 * Returns the exit code.
 */
export function execPassthrough(
  command: string,
  args: string[],
  options?: SpawnOptions,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawnCommand(command, args, {
      stdio: "inherit",
      ...options,
    });

    proc.on("error", reject);
    proc.on("close", (code) => resolve(code ?? 1));
  });
}
