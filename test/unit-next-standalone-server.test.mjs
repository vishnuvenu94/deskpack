import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findStandaloneServerJsFile } from "../dist/next-standalone-server.js";

test("findStandaloneServerJsFile returns flat standalone/server.js when present", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deskpack-next-flat-"));
  fs.writeFileSync(path.join(dir, "server.js"), "// flat\n");

  assert.equal(findStandaloneServerJsFile(dir), path.join(dir, "server.js"));
});

test("findStandaloneServerJsFile returns nested standalone/<app>/server.js", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deskpack-next-nested-"));
  const appRoot = path.join(dir, "my-app");
  fs.mkdirSync(appRoot, { recursive: true });
  fs.writeFileSync(path.join(appRoot, "server.js"), "// nested\n");

  assert.equal(findStandaloneServerJsFile(dir), path.join(appRoot, "server.js"));
});
