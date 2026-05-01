import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveLocalBin } from "../dist/utils/exec.js";

test("resolveLocalBin resolves Windows cmd shims", () => {
  const resolved = resolveLocalBin("desktop", "electron-builder", "win32");
  assert.equal(
    resolved,
    path.join("desktop", "node_modules", ".bin", "electron-builder.cmd"),
  );
});

test("resolveLocalBin resolves extensionless Unix binaries", () => {
  const resolved = resolveLocalBin("desktop", "electron", "darwin");
  assert.equal(
    resolved,
    path.join("desktop", "node_modules", ".bin", "electron"),
  );
});
