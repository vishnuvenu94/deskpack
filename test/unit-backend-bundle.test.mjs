import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { bundleBackend } from "../dist/build/backend.js";
import { rebuildBetterSqlite3ForElectron } from "../dist/build/better-sqlite3.js";
import { copyRuntimeDependencies } from "../dist/build/runtime-deps.js";

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
  const launcher = fs.readFileSync(launcherPath, "utf-8");
  assert.match(launcher, /sqlite-preload\.cjs/);
  assert.match(launcher, /await import\("\.\/src\/server\.mjs"\)/);

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

test("bundleBackend rewrites managed better-sqlite3 ESM imports through runtime database shim", async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskpack-bundle-sqlite-shim-"));
  const srcDir = path.join(projectDir, "src");
  const outDir = path.join(projectDir, ".deskpack", "desktop", "server");
  const packageDir = path.join(projectDir, "node_modules", "better-sqlite3");

  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(packageDir, { recursive: true });

  fs.writeFileSync(
    path.join(packageDir, "package.json"),
    JSON.stringify({ name: "better-sqlite3", version: "1.0.0", main: "index.js" }),
  );
  fs.writeFileSync(
    path.join(packageDir, "index.js"),
    "function Database(filename) { this.filename = filename; }\nmodule.exports = Database;\n",
  );
  fs.writeFileSync(
    path.join(srcDir, "server.js"),
    [
      'import fs from "node:fs";',
      'import Database from "better-sqlite3";',
      'const sqlite = new Database("./data/app.db");',
      'fs.writeFileSync("resolved.txt", sqlite.filename);',
      "",
    ].join("\n"),
  );

  const config = sampleConfig(projectDir);
  config.backend.nativeDeps = ["better-sqlite3"];
  config.database = {
    provider: "sqlite",
    mode: "managed-local",
    driver: "better-sqlite3",
    runtimeFileName: "app.db",
    userDataSubdir: "database",
    env: {
      pathVar: "DESKPACK_DB_PATH",
      urlVar: "DATABASE_URL",
    },
    migrations: {
      tool: "none",
      autoRun: false,
    },
    warnings: [],
  };

  await bundleBackend(projectDir, config, outDir);
  fs.cpSync(path.join(projectDir, "node_modules"), path.join(outDir, "node_modules"), {
    recursive: true,
  });

  const bundle = fs.readFileSync(path.join(outDir, "src", "server.mjs"), "utf-8");
  assert.match(bundle, /deskpack-managed-sqlite:better-sqlite3/);
  assert.doesNotMatch(bundle, /from "better-sqlite3"/);

  const result = spawnSync(process.execPath, [path.join(outDir, "server.mjs")], {
    cwd: outDir,
    env: {
      ...process.env,
      DESKPACK_DB_PATH: "/runtime/app.db",
    },
    encoding: "utf-8",
  });
  assert.equal(result.status, 0, `${result.stdout || ""}${result.stderr || ""}`);
  assert.equal(fs.readFileSync(path.join(outDir, "resolved.txt"), "utf-8"), "/runtime/app.db");
});

test("copyRuntimeDependencies copies Prisma generated client engines", () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskpack-prisma-runtime-"));
  const backendDir = path.join(projectDir, "backend");
  const prismaClientDir = path.join(backendDir, "node_modules", ".prisma", "client");
  const prismaPackageDir = path.join(backendDir, "node_modules", "@prisma", "client");
  const outDir = path.join(projectDir, ".deskpack", "desktop", "server");

  fs.mkdirSync(prismaClientDir, { recursive: true });
  fs.mkdirSync(prismaPackageDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(backendDir, "package.json"), JSON.stringify({ dependencies: { "@prisma/client": "5.22.0" } }));
  fs.writeFileSync(path.join(prismaClientDir, "package.json"), JSON.stringify({ name: ".prisma/client" }));
  fs.writeFileSync(path.join(prismaClientDir, "libquery_engine-darwin-arm64.dylib.node"), "engine");
  fs.writeFileSync(path.join(prismaPackageDir, "package.json"), JSON.stringify({ name: "@prisma/client" }));
  fs.writeFileSync(path.join(prismaPackageDir, "index.js"), "module.exports = {}");

  const config = sampleConfig(projectDir);
  config.backend.path = "backend";
  copyRuntimeDependencies(projectDir, config, outDir);

  assert.ok(
    fs.existsSync(
      path.join(outDir, "node_modules", ".prisma", "client", "libquery_engine-darwin-arm64.dylib.node"),
    ),
  );
  assert.ok(fs.existsSync(path.join(outDir, "node_modules", "@prisma", "client", "package.json")));
});

/** Mirrors libsql optional platform packages (see `libsql` package optionalDependencies). */
function libsqlOptionalPlatformPackageName() {
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "@libsql/darwin-arm64" : "@libsql/darwin-x64";
  }
  if (process.platform === "linux") {
    return process.arch === "arm64"
      ? "@libsql/linux-arm64-gnu"
      : "@libsql/linux-x64-gnu";
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return "@libsql/win32-x64-msvc";
  }
  return null;
}

test(
  "copyRuntimeDependencies copies libsql client and platform optional binary package",
  { skip: libsqlOptionalPlatformPackageName() === null },
  () => {
    const platformPkg = /** @type {string} */ (libsqlOptionalPlatformPackageName());

    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskpack-libsql-runtime-"));
    const backendDir = path.join(projectDir, "backend");
    const nodeModules = path.join(backendDir, "node_modules");
    const outDir = path.join(projectDir, ".deskpack", "desktop", "server");

    fs.mkdirSync(path.join(nodeModules, "@libsql", "client"), { recursive: true });
    fs.mkdirSync(path.join(nodeModules, "libsql"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "libsql-runtime-test", version: "1.0.0" }),
    );
    fs.writeFileSync(
      path.join(backendDir, "package.json"),
      JSON.stringify({ dependencies: { "@libsql/client": "1.0.0" } }),
    );

    const platformDir = path.join(nodeModules, ...platformPkg.split("/"));
    fs.mkdirSync(platformDir, { recursive: true });

    fs.writeFileSync(
      path.join(nodeModules, "@libsql", "client", "package.json"),
      JSON.stringify({
        name: "@libsql/client",
        version: "1.0.0",
        dependencies: { libsql: "1.0.0" },
      }),
    );
    fs.writeFileSync(
      path.join(nodeModules, "libsql", "package.json"),
      JSON.stringify({
        name: "libsql",
        version: "1.0.0",
        optionalDependencies: { [platformPkg]: "1.0.0" },
      }),
    );
    fs.writeFileSync(
      path.join(platformDir, "package.json"),
      JSON.stringify({ name: platformPkg, version: "1.0.0" }),
    );
    fs.writeFileSync(path.join(platformDir, "libsql.platform.node"), "native");

    fs.mkdirSync(outDir, { recursive: true });

    const config = sampleConfig(projectDir);
    config.backend.path = "backend";
    config.backend.nativeDeps = ["@libsql/client"];

    copyRuntimeDependencies(projectDir, config, outDir);

    assert.ok(
      fs.existsSync(path.join(outDir, "node_modules", "@libsql", "client", "package.json")),
    );
    assert.ok(fs.existsSync(path.join(outDir, "node_modules", "libsql", "package.json")));
    assert.ok(
      fs.existsSync(
        path.join(outDir, "node_modules", ...platformPkg.split("/"), "libsql.platform.node"),
      ),
    );
  },
);

test("copyRuntimeDependencies copies Playwright browsers into the server runtime", () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskpack-playwright-runtime-"));
  const nodeModules = path.join(projectDir, "node_modules");
  const outDir = path.join(projectDir, ".deskpack", "desktop", "server");
  const browserDir = path.join(
    nodeModules,
    "playwright-core",
    ".local-browsers",
    "chromium_headless_shell-1217",
  );

  fs.mkdirSync(path.join(nodeModules, "playwright"), { recursive: true });
  fs.mkdirSync(browserDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "package.json"),
    JSON.stringify({ dependencies: { playwright: "1.59.1" } }),
  );
  fs.writeFileSync(
    path.join(nodeModules, "playwright", "package.json"),
    JSON.stringify({
      name: "playwright",
      version: "1.59.1",
      dependencies: { "playwright-core": "1.59.1" },
    }),
  );
  fs.writeFileSync(
    path.join(nodeModules, "playwright-core", "package.json"),
    JSON.stringify({ name: "playwright-core", version: "1.59.1" }),
  );
  fs.writeFileSync(path.join(browserDir, "chrome-headless-shell"), "browser");

  const config = sampleConfig(projectDir);
  config.backend.nativeDeps = ["playwright"];

  copyRuntimeDependencies(projectDir, config, outDir);

  assert.ok(fs.existsSync(path.join(outDir, "node_modules", "playwright", "package.json")));
  assert.ok(fs.existsSync(path.join(outDir, "node_modules", "playwright-core", "package.json")));
  assert.equal(
    fs.readFileSync(
      path.join(outDir, "ms-playwright", "chromium_headless_shell-1217", "chrome-headless-shell"),
      "utf-8",
    ),
    "browser",
  );
});

test("copyRuntimeDependencies prunes stale Playwright browser cache entries", () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskpack-playwright-prune-"));
  const nodeModules = path.join(projectDir, "node_modules");
  const playwrightCoreDir = path.join(nodeModules, "playwright-core");
  const browserCache = path.join(playwrightCoreDir, ".local-browsers");
  const outDir = path.join(projectDir, ".deskpack", "desktop", "server");

  fs.mkdirSync(path.join(nodeModules, "playwright"), { recursive: true });
  fs.mkdirSync(path.join(browserCache, "chromium_headless_shell-1217"), { recursive: true });
  fs.mkdirSync(path.join(browserCache, "ffmpeg_mac12_arm64_special-1010"), { recursive: true });
  fs.mkdirSync(path.join(browserCache, "chromium_headless_shell-1161"), { recursive: true });
  fs.mkdirSync(path.join(browserCache, "firefox-1475"), { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, "package.json"),
    JSON.stringify({ dependencies: { playwright: "1.59.1" } }),
  );
  fs.writeFileSync(
    path.join(nodeModules, "playwright", "package.json"),
    JSON.stringify({
      name: "playwright",
      version: "1.59.1",
      dependencies: { "playwright-core": "1.59.1" },
    }),
  );
  fs.writeFileSync(
    path.join(playwrightCoreDir, "package.json"),
    JSON.stringify({ name: "playwright-core", version: "1.59.1" }),
  );
  fs.writeFileSync(
    path.join(playwrightCoreDir, "browsers.json"),
    JSON.stringify({
      browsers: [
        {
          name: "chromium-headless-shell",
          revision: "1217",
          installByDefault: true,
        },
        {
          name: "ffmpeg",
          revision: "1011",
          installByDefault: true,
          revisionOverrides: {
            "mac12-arm64": "1010",
          },
        },
      ],
    }),
  );
  fs.writeFileSync(
    path.join(browserCache, "chromium_headless_shell-1217", "chrome-headless-shell"),
    "current",
  );
  fs.writeFileSync(
    path.join(browserCache, "chromium_headless_shell-1161", "chrome-headless-shell"),
    "stale",
  );
  fs.writeFileSync(path.join(browserCache, "ffmpeg_mac12_arm64_special-1010", "ffmpeg"), "current");
  fs.writeFileSync(path.join(browserCache, "firefox-1475", "firefox"), "stale");

  const config = sampleConfig(projectDir);
  config.backend.nativeDeps = ["playwright"];

  copyRuntimeDependencies(projectDir, config, outDir);

  assert.deepEqual(fs.readdirSync(path.join(outDir, "ms-playwright")).sort(), [
    "chromium_headless_shell-1217",
    "ffmpeg_mac12_arm64_special-1010",
  ]);
});

test("non-Next better-sqlite3 runtime binding is rebuilt for Electron", async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskpack-better-backend-"));
  const desktopDir = path.join(projectDir, ".deskpack", "desktop");
  const backendDir = path.join(projectDir, "backend");
  const nodeModules = path.join(backendDir, "node_modules");
  const outDir = path.join(desktopDir, "server");

  fs.mkdirSync(path.join(desktopDir, "node_modules", "electron"), { recursive: true });
  fs.writeFileSync(
    path.join(desktopDir, "node_modules", "electron", "package.json"),
    JSON.stringify({ version: "33.4.11" }),
  );
  installFakeElectronRebuild(desktopDir);

  fs.writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({}));
  fs.mkdirSync(backendDir, { recursive: true });
  fs.writeFileSync(
    path.join(backendDir, "package.json"),
    JSON.stringify({ dependencies: { "better-sqlite3": "1.0.0" } }),
  );
  writeBetterSqlitePackage(path.join(nodeModules, "better-sqlite3"), "backend-host");
  fs.mkdirSync(outDir, { recursive: true });

  const config = sampleConfig(projectDir);
  config.backend.path = "backend";
  config.backend.nativeDeps = ["better-sqlite3"];

  copyRuntimeDependencies(projectDir, config, outDir);
  await rebuildBetterSqlite3ForElectron(projectDir, desktopDir, outDir, config, {
    skipPackage: false,
  });

  assert.equal(
    fs.readFileSync(
      path.join(nodeModules, "better-sqlite3", "build", "Release", "better_sqlite3.node"),
      "utf-8",
    ),
    "backend-host",
  );
  assert.equal(
    fs.readFileSync(
      path.join(outDir, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"),
      "utf-8",
    ),
    "electron-backend",
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
      "fs.writeFileSync(binary, 'electron-backend');",
      "",
    ].join("\n"),
  );
  fs.chmodSync(binPath, 0o755);
}
