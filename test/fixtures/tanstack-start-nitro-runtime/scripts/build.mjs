import fs from "node:fs"
import path from "node:path"

const serverDir = path.join(process.cwd(), ".output", "server")
const publicDir = path.join(process.cwd(), ".output", "public")

fs.mkdirSync(serverDir, { recursive: true })
fs.mkdirSync(publicDir, { recursive: true })
fs.writeFileSync(
  path.join(serverDir, "index.mjs"),
  [
    "import http from 'node:http'",
    "",
    "const port = Number(process.env.NITRO_PORT || process.env.PORT || 3000)",
    "const host = process.env.NITRO_HOST || process.env.HOST || '127.0.0.1'",
    "http.createServer((_req, res) => {",
    "  res.writeHead(200, { 'Content-Type': 'text/plain' })",
    "  res.end('tanstack start nitro runtime')",
    "}).listen(port, host)",
    "",
  ].join("\n"),
)
fs.writeFileSync(
  path.join(publicDir, "asset.txt"),
  "tanstack public asset\n",
)
