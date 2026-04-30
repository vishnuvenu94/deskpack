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

if (process.platform !== "win32") {
  const mode = fs.statSync(cliPath).mode;
  if ((mode & 0o111) === 0) {
    fail(
      "dist/cli.js is not executable (npm bin needs +x). Run npm run build.",
    );
  }
}

console.log("Bin validation passed.");

function fail(message) {
  console.error(message);
  process.exit(1);
}
