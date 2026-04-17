import assert from "node:assert/strict";
import { commandOutput, copyFixtureToTemp, runCli } from "./helpers.mjs";

const projectDir = copyFixtureToTemp("frontend-only-static");

const initResult = runCli(["init", "--yes", "--force"], projectDir, {
  DESKPACK_SKIP_ELECTRON_INSTALL: "1",
});
assert.equal(initResult.status, 0, commandOutput(initResult));

const buildResult = runCli(["build", "--skip-package"], projectDir);
assert.equal(buildResult.status, 0, commandOutput(buildResult));

console.log("Smoke check passed.");
