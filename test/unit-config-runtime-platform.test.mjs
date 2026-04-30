import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import {
  createManagedSqlitePreload,
  detectHardcodedSqlitePaths,
} from "../dist/build/database.js";
import { loadConfig } from "../dist/config.js";
import { generateElectronMain } from "../dist/generate/electron-main.js";
import { inspectPlatformBuild } from "../dist/build/platform.js";

function sampleConfig() {
  return {
    name: "Sample App",
    appId: "com.sample.app",
    version: "1.0.0",
    frontend: {
      path: ".",
      framework: "vite",
      buildCommand: "vite build",
      distDir: "dist",
      devPort: 5173,
    },
    backend: {
      path: "",
      framework: "unknown",
      entry: "",
      devPort: 0,
      nativeDeps: [],
      healthCheckPath: "/health",
    },
    monorepo: {
      type: "none",
      packageManager: "npm",
    },
    topology: "frontend-only-static",
    topologyEvidence: {
      staticServingPatterns: [],
      ssrPatterns: [],
      staticRoot: null,
      frontendDistFound: false,
      warnings: [],
    },
    electron: {
      window: { width: 1200, height: 800 },
    },
  };
}

test("loadConfig reads deskpack.config.json and normalizes health path defaults", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskpack-config-test-"));
  const configPath = path.join(tmpDir, "deskpack.config.json");

  const config = sampleConfig();
  delete config.backend.healthCheckPath;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  const loaded = loadConfig(tmpDir);
  assert.equal(loaded.name, "Sample App");
  assert.equal(loaded.backend.healthCheckPath, "/");
});

test("generated electron runtime includes single-instance + hardening logic", () => {
  const runtime = generateElectronMain(sampleConfig());
  assert.match(runtime, /requestSingleInstanceLock/);
  assert.match(runtime, /resolvePort/);
  assert.match(runtime, /serveStaticRequest/);
  assert.match(runtime, /sandbox:\s*true/);
  assert.match(runtime, /webSecurity:\s*true/);
  assert.match(runtime, /installPermissionGuards/);
  assert.match(runtime, /Blocked navigation to disallowed URL/);
  assert.match(runtime, /isAllowedExternalUrl/);
  assert.match(runtime, /access-control-allow-origin/);
  assert.match(runtime, /BACKEND_PROXY_PREFIX = "\/__deskpack_backend__"/);
  assert.match(runtime, /proxyAbsoluteBackendRequest/);
  assert.match(runtime, /withRendererCorsHeaders/);
  assert.match(runtime, /TOPOLOGY === "frontend-static-separate"/);
  assert.match(runtime, /connect-src 'self' https: http:\/\/127\.0\.0\.1:\* http:\/\/localhost:\*/);
  assert.match(runtime, /trpc-accept, x-trpc-source/);
  assert.match(runtime, /function findHeaderName/);
  assert.match(runtime, /function setHeaderValue/);
  assert.match(runtime, /if \(PREFERRED_API_PORT !== actualBackendPort\)/);
  assert.doesNotMatch(runtime, /usePackagedStaticAbsoluteProxy/);
  assert.doesNotMatch(runtime, /access-control-allow-origin"\]\s*=\s*\["\*"\]/);
  assert.doesNotMatch(runtime, /webSecurity:\s*false/);
  assert.match(runtime, /\[deskpack\]/);
  assert.doesNotMatch(runtime, /shipdesk/i);
});

test("generated static server supports TanStack _shell.html and prerendered HTML", () => {
  const runtime = generateElectronMain(sampleConfig());
  assert.match(runtime, /_shell\.html/);
  assert.match(runtime, /resolvePackagedHtmlEntry/);
  assert.match(runtime, /hasAnyHtmlUnder/);
});

test("platform policy allows same-platform builds", () => {
  const host = process.platform;
  if (!["darwin", "linux", "win32"].includes(host)) {
    return;
  }
  const decision = inspectPlatformBuild(sampleConfig(), host, host);
  assert.equal(decision.allowed, true);
});

test("platform policy refuses unsupported cross-platform targets", () => {
  const host = process.platform;
  if (!["darwin", "linux", "win32"].includes(host)) {
    return;
  }

  const target = host === "darwin" ? "linux" : "darwin";
  const decision = inspectPlatformBuild(sampleConfig(), target, host);
  assert.equal(decision.allowed, false);
  assert.ok(decision.reasons.length > 0);
});

test("platform policy blocks windows cross-build when native deps exist", () => {
  const config = sampleConfig();
  config.backend.nativeDeps = ["better-sqlite3"];
  const decision = inspectPlatformBuild(config, "win32", "darwin");
  assert.equal(decision.allowed, false);
  assert.match(decision.reasons.join("\n"), /native\/runtime dependencies/i);
});

test("generated electron runtime includes API proxy for frontend-static-separate topology", () => {
  const config = sampleConfig();
  config.topology = "frontend-static-separate";
  config.backend = {
    path: ".",
    framework: "express",
    entry: "server.js",
    devPort: 3000,
    nativeDeps: [],
    healthCheckPath: "/health",
    apiPrefixes: ["/api"],
  };
  const runtime = generateElectronMain(config);
  assert.match(runtime, /API_PROXY_PREFIXES/);
  assert.match(runtime, /proxyApiRequest/);
  assert.match(runtime, /delete forwardedHeaders\.host/);
  assert.match(runtime, /response\.writeHead\(proxyResponse\.statusCode, withRendererCorsHeaders\(proxyResponse\.headers\)\)/);
  assert.match(runtime, /setHeaderValue\(headers, "access-control-allow-origin"/);
  assert.match(runtime, /TOPOLOGY === "frontend-static-separate"/);
  assert.match(runtime, /if \(PREFERRED_API_PORT !== actualBackendPort\)/);
  assert.doesNotMatch(runtime, /logInfo\("Proxying "/);
  assert.match(runtime, /startBundledBackend\(PREFERRED_API_PORT\)/);
  assert.match(runtime, /startStaticServer\(PREFERRED_FRONTEND_PORT, backendPort\)/);
});

test("generated electron runtime verifies backend-served frontend routes", () => {
  const config = sampleConfig();
  config.topology = "backend-serves-frontend";
  config.backend = {
    path: ".",
    framework: "express",
    entry: "src/server.js",
    devPort: 3000,
    nativeDeps: [],
    healthCheckPath: "/health",
    apiPrefixes: ["/api"],
  };

  const runtime = generateElectronMain(config);
  assert.match(runtime, /ensureBackendServesFrontend/);
  assert.match(runtime, /await ensureBackendServesFrontend\(backendPort\)/);
  assert.match(runtime, /did not serve frontend routes/);
});

test("generated electron runtime requires the configured backend port", () => {
  const config = sampleConfig();
  config.topology = "frontend-static-separate";
  config.backend = {
    path: ".",
    framework: "nestjs",
    entry: "backend/src/main.ts",
    devPort: 3300,
    nativeDeps: [],
    healthCheckPath: "/health",
    apiPrefixes: ["/api"],
  };

  const runtime = generateElectronMain(config);
  assert.match(runtime, /requireConfiguredPort/);
  assert.match(
    runtime,
    /Configured[\s\S]*is unavailable\. Stop the process using it or update deskpack\.config\.json\./,
  );
  assert.match(runtime, /DESKPACK_BACKEND_PORT/);
});

test("frontend-only-static topology has no API proxy when backendPort is 0", () => {
  const config = sampleConfig();
  config.topology = "frontend-only-static";
  const runtime = generateElectronMain(config);
  assert.match(runtime, /startStaticServer\(PREFERRED_FRONTEND_PORT, 0\)/);
});

test("generated electron runtime starts Next standalone server", () => {
  const config = sampleConfig();
  config.frontend.framework = "next";
  config.frontend.nextRuntime = {
    mode: "standalone",
    standaloneDir: ".next/standalone",
    serverFile: ".next/standalone/server.js",
    staticDir: ".next/static",
    publicDir: "public",
    warnings: [],
  };
  config.topology = "next-standalone-runtime";

  const runtime = generateElectronMain(config);
  assert.match(runtime, /startNextStandaloneServer/);
  assert.match(runtime, /TOPOLOGY === "next-standalone-runtime"/);
  assert.match(runtime, /HOSTNAME: "127\.0\.0\.1"/);
  assert.match(runtime, /serviceName: "deskpack-next"/);
});

test("generated electron runtime prepares managed SQLite env", () => {
  const config = sampleConfig();
  config.database = {
    provider: "sqlite",
    mode: "managed-local",
    driver: "better-sqlite3",
    templatePath: "data/seed.db",
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

  const runtime = generateElectronMain(config);
  assert.match(runtime, /DATABASE_CONFIG/);
  assert.match(runtime, /prepareManagedSqliteDatabase/);
  assert.match(runtime, /app\.getPath\("userData"\)/);
  assert.match(runtime, /template\.db/);
  assert.match(runtime, /sqliteFileHasUserTables/);
  assert.match(runtime, /Repaired uninitialized SQLite database/);
  assert.match(runtime, /removeSqliteSidecars/);
  assert.match(runtime, /managedSqliteExecArgv/);
  assert.match(runtime, /sqlite-preload\.cjs/);
  assert.match(runtime, /serverRuntimeEnv/);
  assert.match(runtime, /"file:" \+ runtimePath/);
  assert.match(runtime, /DATABASE_URL/);
  assert.match(runtime, /DESKPACK_DB_PATH/);
  assert.doesNotMatch(runtime, /pathToFileURL/);
});

test("managed SQLite preload rewrites hardcoded better-sqlite3 paths", () => {
  const source = createManagedSqlitePreload(["data/sqlite.db", "/app/data/sqlite.db"]);

  function FakeDatabase(filename) {
    this.filename = filename;
  }

  const moduleApi = {
    _load(request) {
      if (
        request !== "better-sqlite3" &&
        request !== "/app/node_modules/better-sqlite3/lib/index.js"
      ) {
        throw new Error(`Unexpected request: ${request}`);
      }
      return FakeDatabase;
    },
  };

  const context = {
    process: {
      env: { DESKPACK_DB_PATH: "/runtime/app.db" },
      cwd: () => "/app",
    },
    require(request) {
      if (request === "module") return moduleApi;
      if (request === "path") return path;
      throw new Error(`Unexpected require: ${request}`);
    },
  };

  vm.runInNewContext(source, context);

  const PatchedDatabase = moduleApi._load("better-sqlite3");
  const AbsolutePatchedDatabase = moduleApi._load("/app/node_modules/better-sqlite3/lib/index.js");
  assert.equal(new PatchedDatabase("./data/sqlite.db").filename, "/runtime/app.db");
  assert.equal(new AbsolutePatchedDatabase("./data/sqlite.db").filename, "/runtime/app.db");
  assert.equal(new PatchedDatabase("data/sqlite.db").filename, "/runtime/app.db");
  assert.equal(new PatchedDatabase("/app/data/sqlite.db").filename, "/runtime/app.db");
  assert.equal(
    new PatchedDatabase("/Applications/Sample.app/Contents/Resources/data/sqlite.db").filename,
    "/runtime/app.db",
  );
  assert.equal(new PatchedDatabase("./other.db").filename, "./other.db");
  assert.equal(new PatchedDatabase(":memory:").filename, ":memory:");
});

test("managed SQLite preload rewrites hardcoded sqlite3 paths", () => {
  const source = createManagedSqlitePreload(["data/app.db", "/app/data/app.db"]);

  function FakeSqlite3Database(filename) {
    this.filename = filename;
  }

  const sqlite3 = { Database: FakeSqlite3Database };
  const moduleApi = {
    _load(request) {
      if (
        request !== "sqlite3" &&
        request !== "/app/node_modules/sqlite3/lib/sqlite3.js"
      ) {
        throw new Error(`Unexpected request: ${request}`);
      }
      return sqlite3;
    },
  };

  const context = {
    process: {
      env: { DESKPACK_DB_PATH: "/runtime/app.db" },
      cwd: () => "/app",
    },
    require(request) {
      if (request === "module") return moduleApi;
      if (request === "path") return path;
      throw new Error(`Unexpected require: ${request}`);
    },
  };

  vm.runInNewContext(source, context);

  const patchedSqlite3 = moduleApi._load("sqlite3");
  const absolutePatchedSqlite3 = moduleApi._load("/app/node_modules/sqlite3/lib/sqlite3.js");
  assert.equal(new patchedSqlite3.Database("data/app.db").filename, "/runtime/app.db");
  assert.equal(new absolutePatchedSqlite3.Database("data/app.db").filename, "/runtime/app.db");
  assert.equal(new patchedSqlite3.Database("/app/data/app.db").filename, "/runtime/app.db");
  assert.equal(new patchedSqlite3.Database("other.db").filename, "other.db");
  assert.equal(new patchedSqlite3.Database(":memory:").filename, ":memory:");
});

test("detects hardcoded SQLite paths from literals and computed path hints", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskpack-sqlite-paths-"));
  const sourceDir = path.join(tmpDir, "server", "db");
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(
    path.join(sourceDir, "client.ts"),
    [
      'import Database from "better-sqlite3";',
      'const dataDir = path.join(rootDir, "data");',
      'const dbPath = path.join(dataDir, "app.db");',
      "new Database(dbPath);",
      'new Database("./cache/local.sqlite");',
      "",
    ].join("\n"),
  );

  const paths = detectHardcodedSqlitePaths(tmpDir);
  assert.ok(paths.includes("data/app.db"));
  assert.ok(paths.includes(path.join(tmpDir, "data", "app.db").replace(/\\/g, "/")));
  assert.ok(paths.includes("cache/local.sqlite"));
});

test("loadConfig defaults apiPrefixes to [\"/api\"] when missing", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskpack-config-test-"));
  const configPath = path.join(tmpDir, "deskpack.config.json");

  const config = sampleConfig();
  delete config.backend.healthCheckPath;
  delete config.backend.apiPrefixes;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  const loaded = loadConfig(tmpDir);
  assert.deepEqual(loaded.backend.apiPrefixes, ["/api"]);
});

test("loadConfig rejects paths that escape the project root", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskpack-config-test-"));
  const configPath = path.join(tmpDir, "deskpack.config.json");

  const config = sampleConfig();
  config.frontend.distDir = "../outside-dist";
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  assert.throws(
    () => loadConfig(tmpDir),
    /frontend\.distDir resolves outside the project root/i,
  );
});
