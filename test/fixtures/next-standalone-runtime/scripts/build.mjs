import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const standaloneDir = path.join(root, ".next", "standalone");
// Next 13+ often nests the app under `.next/standalone/<project-name>/`.
const appRoot = path.join(standaloneDir, "next-standalone-runtime");
const staticDir = path.join(root, ".next", "static", "chunks");

fs.mkdirSync(appRoot, { recursive: true });
fs.mkdirSync(staticDir, { recursive: true });

fs.writeFileSync(
  path.join(appRoot, "server.js"),
  [
    "const http = require('node:http');",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const port = Number(process.env.PORT || 3000);",
    "const host = process.env.HOSTNAME || '127.0.0.1';",
    "http.createServer((req, res) => {",
    "  if (req.url === '/api/runtime') {",
    "    res.writeHead(200, { 'Content-Type': 'application/json' });",
    "    res.end(JSON.stringify({ runtime: 'next-standalone', host }));",
    "    return;",
    "  }",
    "  if (req.url === '/hello.txt') {",
    "    const publicFile = path.join(__dirname, 'public', 'hello.txt');",
    "    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });",
    "    res.end(fs.readFileSync(publicFile, 'utf-8'));",
    "    return;",
    "  }",
    "  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });",
    "  res.end('<!doctype html><html><body>next standalone ssr</body></html>');",
    "}).listen(port, host);",
    "",
  ].join("\n"),
);

fs.writeFileSync(
  path.join(staticDir, "main.js"),
  "console.log('next static chunk');\n",
);

// Mirror Next traced dependencies: hashed name under appRoot/.next/node_modules symlinked back to appRoot/node_modules/...
const tracePkgDir = path.join(appRoot, "node_modules", "trace-native-pkg");
fs.mkdirSync(tracePkgDir, { recursive: true });
fs.writeFileSync(
  path.join(tracePkgDir, "package.json"),
  JSON.stringify({ name: "trace-native-pkg", version: "1.0.0" }),
);

const tracedNodeModules = path.join(appRoot, ".next", "node_modules");
fs.mkdirSync(tracedNodeModules, { recursive: true });
const symlinkName = "trace-native-pkg-hash123";
const symlinkFrom = path.join(tracedNodeModules, symlinkName);
try {
  fs.symlinkSync(path.relative(path.dirname(symlinkFrom), tracePkgDir), symlinkFrom);
} catch (error) {
  if (/** @type {NodeJS.ErrnoException} */ (error)?.code !== "EEXIST") {
    throw error;
  }
}

function writeBetterSqlitePackage(packageDir, marker) {
  const binaryPath = path.join(packageDir, "build", "Release", "better_sqlite3.node");
  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, "package.json"),
    JSON.stringify({ name: "better-sqlite3", version: "1.0.0" }),
  );
  fs.writeFileSync(binaryPath, marker);
}

const sourceBetterSqliteDir = path.join(root, "node_modules", "better-sqlite3");
const runtimeBetterSqliteDir = path.join(appRoot, "node_modules", "better-sqlite3");
writeBetterSqlitePackage(sourceBetterSqliteDir, "source-host");
writeBetterSqlitePackage(runtimeBetterSqliteDir, "runtime-host");

const betterSqliteSymlink = path.join(tracedNodeModules, "better-sqlite3-hash123");
try {
  fs.symlinkSync(
    path.relative(path.dirname(betterSqliteSymlink), sourceBetterSqliteDir),
    betterSqliteSymlink,
  );
} catch (error) {
  if (/** @type {NodeJS.ErrnoException} */ (error)?.code !== "EEXIST") {
    throw error;
  }
}
