import fs from "node:fs";
import path from "node:path";

const distDir = path.join(process.cwd(), "dist");
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(
  path.join(distDir, "index.html"),
  "<!doctype html><html><body>migration sqlite</body></html>",
);
