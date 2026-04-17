import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const testDir = path.dirname(thisFile);
export const repoRoot = path.resolve(testDir, "..");

export function fixturePath(name) {
  return path.join(testDir, "fixtures", name);
}

export function copyFixtureToTemp(name) {
  const source = fixturePath(name);
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), "deskpack-test-"));
  fs.cpSync(source, destination, { recursive: true });
  return destination;
}

export function runCli(args, cwd, env = {}) {
  return spawnSync(process.execPath, [path.join(repoRoot, "dist", "cli.js"), ...args], {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    encoding: "utf-8",
  });
}

export function commandOutput(result) {
  return `${result.stdout || ""}${result.stderr || ""}`;
}
