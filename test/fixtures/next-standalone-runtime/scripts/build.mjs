import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const standaloneDir = path.join(root, ".next", "standalone");
const staticDir = path.join(root, ".next", "static", "chunks");

fs.mkdirSync(standaloneDir, { recursive: true });
fs.mkdirSync(staticDir, { recursive: true });

fs.writeFileSync(
  path.join(standaloneDir, "server.js"),
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
