import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

interface PackageJson {
  version?: string;
}

export function getDeskpackVersion(): string {
  const pkg = require("../package.json") as PackageJson;
  return pkg.version ?? "0.0.0";
}
