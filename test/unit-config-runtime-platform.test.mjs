import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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
