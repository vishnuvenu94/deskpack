import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { bundleBackend } from "../dist/build/backend.js";

function sampleConfig(projectDir) {
  return {
    name: "Bundle Test",
    appId: "com.bundle.test",
    version: "1.0.0",
    frontend: {
      path: ".",
      framework: "vite",
      buildCommand: "vite build",
      distDir: "dist",
      devPort: 5173,
    },
    backend: {
      path: ".",
      framework: "express",
      entry: "src/server.js",
      devPort: 3017,
      nativeDeps: [],
      healthCheckPath: "/health",
      apiPrefixes: ["/api"],
    },
    monorepo: {
      type: "none",
      packageManager: "npm",
    },
    topology: "backend-serves-frontend",
    topologyEvidence: {
      staticServingPatterns: [],
      ssrPatterns: [],
      staticRoot: null,
      frontendDistFound: true,
      warnings: [],
    },
    electron: {
      window: { width: 1200, height: 800 },
    },
    rootDir: projectDir,
  };
}

test("bundleBackend preserves backend-relative paths via nested module launcher", async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskpack-bundle-backend-"));
  const srcDir = path.join(projectDir, "src");
  const distDir = path.join(projectDir, "dist");
  const outDir = path.join(projectDir, ".deskpack", "desktop", "server");

  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(distDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(distDir, "index.html"), "<!doctype html><html><body>bundle test</body></html>\n");
  fs.writeFileSync(
    path.join(srcDir, "server.js"),
    [
      'import fs from "node:fs";',
      'import path from "node:path";',
      'import { fileURLToPath } from "node:url";',
      "",
      "const __dirname = path.dirname(fileURLToPath(import.meta.url));",
      'const indexPath = path.join(__dirname, "..", "dist", "index.html");',
      "const indexHtml = fs.readFileSync(indexPath, \"utf-8\");",
      'fs.writeFileSync(path.join(__dirname, "..", "resolved.txt"), indexHtml);',
      "",
    ].join("\n"),
  );

  copyDirSync(distDir, path.join(outDir, "dist"));

  await bundleBackend(projectDir, sampleConfig(projectDir), outDir);

  const launcherPath = path.join(outDir, "server.mjs");
  const nestedBundlePath = path.join(outDir, "src", "server.mjs");
  assert.ok(fs.existsSync(launcherPath));
  assert.ok(fs.existsSync(nestedBundlePath));
  assert.match(fs.readFileSync(launcherPath, "utf-8"), /import "\.\/src\/server\.mjs"/);

  const result = spawnSync(process.execPath, [launcherPath], {
    cwd: outDir,
    encoding: "utf-8",
  });
  assert.equal(result.status, 0, `${result.stdout || ""}${result.stderr || ""}`);
  assert.match(
    fs.readFileSync(path.join(outDir, "resolved.txt"), "utf-8"),
    /bundle test/,
  );
});

function copyDirSync(src, dest) {
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
