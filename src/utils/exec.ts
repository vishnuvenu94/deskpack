import { spawn, type SpawnOptions } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
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
      shell: true,
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
      shell: true,
      ...options,
    });

    proc.on("error", reject);
    proc.on("close", (code) => resolve(code ?? 1));
  });
}
