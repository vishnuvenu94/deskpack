import { spawn, type SpawnOptions } from "node:child_process";

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
 * Execute a command, capture its output, and return when it exits.
 */
export function exec(
  command: string,
  args: string[],
  options?: SpawnOptions,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
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
    const proc = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      ...options,
    });

    proc.on("error", reject);
    proc.on("close", (code) => resolve(code ?? 1));
  });
}
