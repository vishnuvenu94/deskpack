import fs from "node:fs";
import path from "node:path";

const cliPath = path.join(process.cwd(), "dist", "cli.js");
if (!fs.existsSync(cliPath)) {
  console.error("dist/cli.js not found. Run tsc first.");
  process.exit(1);
}
fs.chmodSync(cliPath, 0o755);
