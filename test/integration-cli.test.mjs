import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { commandOutput, copyFixtureToTemp, runCli } from "./helpers.mjs";

test("deskpack init creates deskpack.config.json and .deskpack workspace", () => {
  const projectDir = copyFixtureToTemp("frontend-only-static");

  const result = runCli(["init", "--yes", "--force"], projectDir, {
    DESKPACK_SKIP_ELECTRON_INSTALL: "1",
  });

  assert.equal(result.status, 0, commandOutput(result));
  assert.ok(fs.existsSync(path.join(projectDir, "deskpack.config.json")));
  assert.ok(fs.existsSync(path.join(projectDir, ".deskpack", "desktop", "main.cjs")));
  assert.ok(fs.existsSync(path.join(projectDir, ".deskpack", "desktop", "package.json")));
});

test("deskpack build --skip-package works for frontend-only projects", () => {
  const projectDir = copyFixtureToTemp("frontend-only-static");

  const initResult = runCli(["init", "--yes", "--force"], projectDir, {
    DESKPACK_SKIP_ELECTRON_INSTALL: "1",
  });
  assert.equal(initResult.status, 0, commandOutput(initResult));

  const buildResult = runCli(["build", "--skip-package"], projectDir);
  assert.equal(buildResult.status, 0, commandOutput(buildResult));

  const serverDir = path.join(projectDir, ".deskpack", "desktop", "server");
  assert.ok(fs.existsSync(path.join(serverDir, "web-dist", "index.html")));
  assert.equal(fs.existsSync(path.join(serverDir, "server.mjs")), false);
});

test("deskpack init captures hardcoded Nest backend port and health route", () => {
  const projectDir = copyFixtureToTemp("nest-hardcoded-port");

  const result = runCli(["init", "--yes", "--force"], projectDir, {
    DESKPACK_SKIP_ELECTRON_INSTALL: "1",
  });

  assert.equal(result.status, 0, commandOutput(result));

  const config = JSON.parse(
    fs.readFileSync(path.join(projectDir, "deskpack.config.json"), "utf-8"),
  );
  assert.equal(config.backend.devPort, 3300);
  assert.equal(config.backend.healthCheckPath, "/health");
});

test("deskpack init refuses Next SSR/server runtime projects early", () => {
  const projectDir = copyFixtureToTemp("next-ssr-unsupported");

  const result = runCli(["init", "--yes"], projectDir, {
    DESKPACK_SKIP_ELECTRON_INSTALL: "1",
  });
  const output = commandOutput(result);

  assert.notEqual(result.status, 0, output);
  assert.match(output, /static export|output:\s*"export"/i);
});

test("deskpack build refuses unsupported cross-platform packaging with reasons", () => {
  const projectDir = copyFixtureToTemp("frontend-only-static");

  const initResult = runCli(["init", "--yes", "--force"], projectDir, {
    DESKPACK_SKIP_ELECTRON_INSTALL: "1",
  });
  assert.equal(initResult.status, 0, commandOutput(initResult));

  // Build command requires electron to be present when packaging is enabled.
  fs.mkdirSync(
    path.join(projectDir, ".deskpack", "desktop", "node_modules", "electron"),
    { recursive: true },
  );

  const unsupportedTarget =
    process.platform === "darwin"
      ? "linux"
      : "darwin";

  const result = runCli(["build", "--platform", unsupportedTarget], projectDir);
  const output = commandOutput(result);

  assert.notEqual(result.status, 0, output);
  assert.match(output, /Cannot create this platform build reliably/i);
  assert.match(output, /Build this installer on/i);
});
