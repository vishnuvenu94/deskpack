import fs from "node:fs";
import path from "node:path";
import esbuild from "esbuild";
import type { DeskpackConfig } from "../types.js";
import { log } from "../utils/logger.js";

/**
 * Bundle the backend server into a single `server.cjs` file using esbuild.
 *
 * Native modules (e.g. playwright, sharp) are marked as external so they
 * are not inlined and can be provided at runtime.
 */
export async function bundleBackend(
  rootDir: string,
  config: DeskpackConfig,
  outDir: string,
): Promise<void> {
  const entry = path.resolve(rootDir, config.backend.entry);
  const outfile = path.join(outDir, "server.mjs");

  if (!fs.existsSync(entry)) {
    throw new Error(`Backend entry point not found: ${entry}`);
  }

  const external = [...new Set(config.backend.nativeDeps)];

  // NestJS core lazily requires optional packages at runtime.
  // Mark them as external so esbuild doesn't fail when they aren't installed.
  if (config.backend.framework === "nestjs") {
    const nestjsOptional = [
      "@nestjs/microservices",
      "@nestjs/microservices/microservices-module",
      "@nestjs/websockets",
      "@nestjs/websockets/socket-module",
    ];
    for (const dep of nestjsOptional) {
      if (!external.includes(dep)) external.push(dep);
    }
  }

  log.step("Bundling backend", `${config.backend.entry} → server.mjs`);

  if (external.length > 0) {
    log.dim(`  External modules: ${external.join(", ")}`);
  }

  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    outfile,
    external,
    sourcemap: true,
    minify: false, // keep readable for debugging
    banner: {
      js: [
        'import { createRequire as __deskpackCreateRequire } from "node:module";',
        "const require = __deskpackCreateRequire(import.meta.url);",
        "// Bundled by deskpack",
      ].join("\n"),
    },
    logLevel: "warning",
  });

  log.success(`Backend bundled → ${path.relative(rootDir, outfile)}`);
}
