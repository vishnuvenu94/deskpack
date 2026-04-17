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
