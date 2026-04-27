import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = process.cwd();
const packageJsonPath = path.join(rootDir, "package.json");
const cliPath = path.join(rootDir, "dist", "cli.js");

if (!fs.existsSync(packageJsonPath)) {
  fail("package.json not found.");
}

if (!fs.existsSync(cliPath)) {
  fail("dist/cli.js not found. Run build first.");
}

const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
const expectedVersion = pkg.version;

if (typeof expectedVersion !== "string" || expectedVersion.trim().length === 0) {
  fail("package.json version is missing or invalid.");
}

const result = spawnSync(process.execPath, [cliPath, "--version"], {
  cwd: rootDir,
  encoding: "utf-8",
});

if (result.status !== 0) {
  fail(`Failed to read CLI version.\n${result.stderr || result.stdout}`);
}

const actualVersion = (result.stdout || "").trim();
if (actualVersion !== expectedVersion) {
  fail(`CLI version mismatch. Expected "${expectedVersion}", found "${actualVersion}".`);
}

console.log("Version validation passed.");

function fail(message) {
  console.error(message);
  process.exit(1);
}
