import type { ShipdeskConfig } from "../types.js";

/**
 * Generate a `package.json` for the `.shipdesk/desktop/` Electron project.
 */
export function generateDesktopPackageJson(config: ShipdeskConfig): string {
  const safeName = config.name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const nativeDeps = config.backend.nativeDeps.reduce(
    (acc, dep) => {
      acc[dep] = "*";
      return acc;
    },
    {} as Record<string, string>,
  );

  const pkg = {
    name: `${safeName}-desktop`,
    version: config.version,
    private: true,
    main: "main.cjs",
    scripts: {
      dev: "electron .",
      build: "electron-builder --config electron-builder.yml",
    },
    dependencies: nativeDeps,
    devDependencies: {
      electron: "^33.3.1",
      "electron-builder": "^25.1.8",
    },
  };

  return JSON.stringify(pkg, null, 2) + "\n";
}
