import fs from "node:fs"
import path from "node:path"

const clientDir = path.join(process.cwd(), "dist", "client")
fs.mkdirSync(path.join(clientDir, "assets"), { recursive: true })

fs.writeFileSync(
  path.join(clientDir, "_shell.html"),
  "<!doctype html><html><body>tanstack spa shell</body></html>\n",
)
