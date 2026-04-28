import fs from "node:fs";
import path from "node:path";
import type { DeskpackConfig } from "../types.js";
import { log } from "../utils/logger.js";

/**
 * Copy Next.js standalone output into the packaged server resources.
 */
export function copyNextStandaloneRuntime(
  rootDir: string,
  config: DeskpackConfig,
  serverDir: string,
): void {
  const nextRuntime = config.frontend.nextRuntime;
  if (!nextRuntime || nextRuntime.mode !== "standalone") {
    throw new Error("Next.js standalone runtime metadata is missing from deskpack.config.json.");
  }

  const standaloneSource = path.resolve(rootDir, nextRuntime.standaloneDir);
  const serverFile = path.resolve(rootDir, nextRuntime.serverFile);
  if (!fs.existsSync(serverFile)) {
    throw new Error(
      `Next.js standalone server not found at ${serverFile}. ` +
        'Ensure next.config.* contains output: "standalone" and that the build succeeded.',
    );
  }

  const destination = path.join(serverDir, "next");
  copyDirSync(standaloneSource, destination);

  const staticSource = path.resolve(rootDir, nextRuntime.staticDir);
  if (fs.existsSync(staticSource)) {
    copyDirSync(staticSource, path.join(destination, ".next", "static"));
  }

  const publicSource = path.resolve(rootDir, nextRuntime.publicDir);
  if (fs.existsSync(publicSource)) {
    copyDirSync(publicSource, path.join(destination, "public"));
  }

  log.success(`Copied Next.js standalone runtime → ${path.relative(rootDir, destination)}`);
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
