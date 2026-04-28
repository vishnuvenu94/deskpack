import fs from "node:fs";
import path from "node:path";

const distDir = path.join(process.cwd(), "dist");
fs.mkdirSync(path.join(distDir, "assets"), { recursive: true });
fs.writeFileSync(path.join(distDir, "index.html"), "<!doctype html><html><body>libsql native</body></html>");
fs.writeFileSync(path.join(distDir, "assets", "app.js"), "console.log('libsql');");
