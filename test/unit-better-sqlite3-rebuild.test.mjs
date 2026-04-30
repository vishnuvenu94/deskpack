import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createBetterSqlite3RebuildArgs,
  findBetterSqlite3RuntimeTargets,
  rebuildBetterSqlite3ForElectron,
} from "../dist/build/better-sqlite3.js";

test("findBetterSqlite3RuntimeTargets resolves traced symlink aliases", () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskpack-better-runtime-"));
  const realPackage = path.join(runtimeDir, "node_modules", "better-sqlite3");
  const tracedNodeModules = path.join(runtimeDir, ".next", "node_modules");
  const tracedLink = path.join(tracedNodeModules, "better-sqlite3-hash123");

  writeBetterSqlitePackage(realPackage, "runtime");
  fs.mkdirSync(tracedNodeModules, { recursive: true });
  fs.symlinkSync(path.relative(path.dirname(tracedLink), realPackage), tracedLink);

  assert.deepEqual(findBetterSqlite3RuntimeTargets(runtimeDir), [
    {
      packageDir: fs.realpathSync(realPackage),
      binaryPath: path.join(
        fs.realpathSync(realPackage),
        "build",
        "Release",
        "better_sqlite3.node",
      ),
    },
  ]);
});

test("findBetterSqlite3RuntimeTargets finds non-Next server runtime packages", () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskpack-better-server-"));
  const packageDir = path.join(runtimeDir, "node_modules", "better-sqlite3");
  writeBetterSqlitePackage(packageDir, "runtime");

  assert.deepEqual(findBetterSqlite3RuntimeTargets(runtimeDir), [
    {
      packageDir: fs.realpathSync(packageDir),
      binaryPath: path.join(
        fs.realpathSync(packageDir),
        "build",
        "Release",
        "better_sqlite3.node",
      ),
    },
  ]);
});

test("createBetterSqlite3RebuildArgs targets project root and Electron ABI", () => {
  assert.deepEqual(
    createBetterSqlite3RebuildArgs({
      electronVersion: "33.4.11",
      projectDir: "/app",
    }),
    [
      "--version",
      "33.4.11",
      "--module-dir",
      "/app",
      "--force",
      "--only",
      "better-sqlite3",
    ],
  );
});

test("rebuildBetterSqlite3ForElectron copies rebuilt binding and restores source binding", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskpack-better-root-"));
  const desktopDir = path.join(rootDir, ".deskpack", "desktop");
  const runtimeDir = path.join(desktopDir, "server", "next");
  const sourcePackage = path.join(rootDir, "node_modules", "better-sqlite3");
  const runtimePackage = path.join(runtimeDir, "node_modules", "better-sqlite3");

  fs.mkdirSync(path.join(desktopDir, "node_modules", "electron"), { recursive: true });
  fs.writeFileSync(
    path.join(desktopDir, "node_modules", "electron", "package.json"),
    JSON.stringify({ version: "33.4.11" }),
  );
  installFakeElectronRebuild(desktopDir);

  fs.writeFileSync(
    path.join(rootDir, "package.json"),
    JSON.stringify({ dependencies: { "better-sqlite3": "1.0.0" } }),
  );
  writeBetterSqlitePackage(sourcePackage, "host");
  writeBetterSqlitePackage(runtimePackage, "runtime");

  await rebuildBetterSqlite3ForElectron(rootDir, desktopDir, runtimeDir, sampleConfig(), {
    skipPackage: false,
  });

  const sourceBinary = path.join(sourcePackage, "build", "Release", "better_sqlite3.node");
  const runtimeBinary = path.join(runtimePackage, "build", "Release", "better_sqlite3.node");
  assert.equal(fs.readFileSync(sourceBinary, "utf-8"), "host");
  assert.equal(fs.readFileSync(runtimeBinary, "utf-8"), "electron");
});

test("rebuildBetterSqlite3ForElectron resolves source package from backend path", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskpack-better-backend-root-"));
  const desktopDir = path.join(rootDir, ".deskpack", "desktop");
  const runtimeDir = path.join(desktopDir, "server");
  const backendDir = path.join(rootDir, "backend");
  const sourcePackage = path.join(backendDir, "node_modules", "better-sqlite3");
  const runtimePackage = path.join(runtimeDir, "node_modules", "better-sqlite3");
  const config = sampleConfig();

  config.frontend.framework = "vite";
  config.frontend.path = "frontend";
  config.backend.path = "backend";
  config.topology = "backend-serves-frontend";

  fs.mkdirSync(path.join(desktopDir, "node_modules", "electron"), { recursive: true });
  fs.writeFileSync(
    path.join(desktopDir, "node_modules", "electron", "package.json"),
    JSON.stringify({ version: "33.4.11" }),
  );
  installFakeElectronRebuild(desktopDir);

  fs.mkdirSync(path.join(rootDir, "frontend"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "frontend", "package.json"), JSON.stringify({}));
  fs.writeFileSync(path.join(rootDir, "package.json"), JSON.stringify({}));
  fs.mkdirSync(backendDir, { recursive: true });
  fs.writeFileSync(
    path.join(backendDir, "package.json"),
    JSON.stringify({ dependencies: { "better-sqlite3": "1.0.0" } }),
  );
  writeBetterSqlitePackage(sourcePackage, "backend-host");
  writeBetterSqlitePackage(runtimePackage, "runtime");

  await rebuildBetterSqlite3ForElectron(rootDir, desktopDir, runtimeDir, config, {
    skipPackage: false,
  });

  assert.equal(
    fs.readFileSync(path.join(sourcePackage, "build", "Release", "better_sqlite3.node"), "utf-8"),
    "backend-host",
  );
  assert.equal(
    fs.readFileSync(path.join(runtimePackage, "build", "Release", "better_sqlite3.node"), "utf-8"),
    "electron",
  );
});


function sampleConfig() {
  return {
    name: "Sample",
    appId: "com.sample.app",
    version: "1.0.0",
    frontend: {
      path: ".",
      framework: "next",
      buildCommand: "next build",
      devCommand: "next dev",
      devPort: 3000,
      distDir: ".next",
      nextRuntime: {
        mode: "standalone",
        standaloneDir: ".next/standalone",
        serverFile: ".next/standalone/server.js",
        staticDir: ".next/static",
        publicDir: "public",
        warnings: [],
      },
    },
    backend: {
      path: "",
      framework: "unknown",
      entry: "",
      devCommand: "",
      devPort: 3000,
      nativeDeps: [],
      healthCheckPath: "/",
    },
    monorepo: { type: "none", packageManager: "npm", workspaces: [] },
    topology: "next-standalone-runtime",
    topologyEvidence: {
      staticServingPatterns: [],
      ssrPatterns: [],
      staticRoot: null,
      frontendDistFound: false,
      warnings: [],
    },
    electron: { window: { width: 1200, height: 800 } },
  };
}

function writeBetterSqlitePackage(packageDir, marker) {
  const binaryPath = path.join(packageDir, "build", "Release", "better_sqlite3.node");
  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, "package.json"),
    JSON.stringify({ name: "better-sqlite3", version: "1.0.0" }),
  );
  fs.writeFileSync(binaryPath, marker);
}

function installFakeElectronRebuild(desktopDir) {
  const binDir = path.join(desktopDir, "node_modules", ".bin");
  const binPath = path.join(binDir, process.platform === "win32" ? "electron-rebuild.cmd" : "electron-rebuild");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    binPath,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const args = process.argv.slice(2);",
      "const moduleDir = args[args.indexOf('--module-dir') + 1];",
      "const binary = path.join(moduleDir, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');",
      "fs.writeFileSync(binary, 'electron');",
      "",
    ].join("\n"),
  );
  fs.chmodSync(binPath, 0o755);
}
