// Topology fixture: backend serves static frontend files.
// Uses only Node.js built-ins so the fixture can be bundled without
// installing its declared dependencies (hono is kept in package.json
// so framework detection still reports "hono").
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(__dirname, "..", "index.html");

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200);
    res.end("ok");
    return;
  }

  // Serve static files from web-dist (topology detection hint)
  const filePath = req.url === "/" ? indexPath : path.join(__dirname, "..", req.url);

  try {
    const content = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    const contentType =
      ext === ".html" ? "text/html" :
      ext === ".js" ? "application/javascript" :
      "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(3000);
