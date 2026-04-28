import fs from "node:fs";
import path from "node:path";
import type { DeskpackConfig } from "../types.js";
import { findStandaloneServerJsFile } from "../next-standalone-server.js";
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
  let serverFile = path.resolve(rootDir, nextRuntime.serverFile);
  if (!fs.existsSync(serverFile)) {
    const discovered = findStandaloneServerJsFile(standaloneSource);
    if (discovered) {
      serverFile = discovered;
    }
  }

  if (!fs.existsSync(serverFile)) {
    throw new Error(
      `Next.js standalone server not found at ${path.resolve(rootDir, nextRuntime.serverFile)} ` +
        `(also checked under ${nextRuntime.standaloneDir}). ` +
        'Ensure next.config.* contains output: "standalone" and that the build succeeded.',
    );
  }

  const standaloneAppRoot = path.dirname(serverFile);
  const destination = path.join(serverDir, "next");
  copyTreeSync(standaloneAppRoot, destination);

  const staticSource = path.resolve(rootDir, nextRuntime.staticDir);
  if (fs.existsSync(staticSource)) {
    copyTreeSync(staticSource, path.join(destination, ".next", "static"));
  }

  const publicSource = path.resolve(rootDir, nextRuntime.publicDir);
  if (fs.existsSync(publicSource)) {
    copyTreeSync(publicSource, path.join(destination, "public"));
  }

  log.success(`Copied Next.js standalone runtime → ${path.relative(rootDir, destination)}`);
}

/**
 * Recursive copy preserving symlinks relative targets. Next traces native deps such as
 * `.next/node_modules/better-sqlite3-<hash> -> ../../node_modules/better-sqlite3`; those are not
 * regular files (see `copyFileSync` / `ENOTSUP`). Node's `fs.cpSync` on some platforms rewrites
 * symlink targets to absolute paths under the source tree, so we copy entries explicitly.
 */
function copyTreeSync(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  copyEntrySync(src, dest);
}

function copyEntrySync(src: string, dest: string): void {
  const stat = fs.lstatSync(src);

  if (stat.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(src, "utf8"), dest);
    return;
  }

  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyEntrySync(path.join(src, name), path.join(dest, name));
    }
    return;
  }

  if (stat.isFile()) {
    fs.copyFileSync(src, dest);
    return;
  }

  throw new Error(
    `Deskpack cannot copy this file type into the Next standalone bundle (not a file, directory, or symlink): ${src}`,
  );
}
