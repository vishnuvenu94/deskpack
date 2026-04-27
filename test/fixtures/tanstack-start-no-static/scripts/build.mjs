import fs from "node:fs"
import path from "node:path"

const clientDir = path.join(process.cwd(), "dist", "client")
fs.mkdirSync(clientDir, { recursive: true })
fs.writeFileSync(
  path.join(clientDir, "index.html"),
  "<!doctype html><html><body>build output</body></html>\n",
)
