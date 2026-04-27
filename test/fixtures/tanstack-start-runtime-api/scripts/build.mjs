import fs from "node:fs"
import path from "node:path"

const clientDir = path.join(process.cwd(), "dist", "client")
fs.mkdirSync(clientDir, { recursive: true })
fs.writeFileSync(
  path.join(clientDir, "index.html"),
  "<!doctype html><html><body>would be static</body></html>\n",
)
