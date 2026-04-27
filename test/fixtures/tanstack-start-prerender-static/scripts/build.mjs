import fs from "node:fs"
import path from "node:path"

const clientDir = path.join(process.cwd(), "dist", "client")
fs.mkdirSync(path.join(clientDir, "blog", "post"), { recursive: true })

fs.writeFileSync(
  path.join(clientDir, "index.html"),
  "<!doctype html><html><body>tanstack prerender home</body></html>\n",
)

fs.writeFileSync(
  path.join(clientDir, "blog", "post", "index.html"),
  "<!doctype html><html><body>nested prerender</body></html>\n",
)
