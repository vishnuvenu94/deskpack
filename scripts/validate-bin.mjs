import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const packageJsonPath = path.join(rootDir, "package.json");
const cliPath = path.join(rootDir, "dist", "cli.js");

if (!fs.existsSync(packageJsonPath)) {
  fail("package.json not found.");
}

const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
if (pkg.name !== "deskpack") {
  fail(`Expected package name "deskpack", found "${pkg.name}".`);
}

if (!pkg.bin || pkg.bin.deskpack !== "dist/cli.js") {
  fail('Expected "bin.deskpack" to point at "dist/cli.js".');
}

if (!fs.existsSync(cliPath)) {
  fail("dist/cli.js not found. Run build first.");
}

const cliSource = fs.readFileSync(cliPath, "utf-8");
if (!cliSource.startsWith("#!/usr/bin/env node")) {
  fail("dist/cli.js is missing the node shebang.");
}

console.log("Bin validation passed.");

function fail(message) {
  console.error(message);
  process.exit(1);
}
