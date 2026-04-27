import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProjectFrontendCommandArgs,
  buildWorkspaceFrontendCommandArgs,
  planFrontendDevLaunch,
} from "../dist/commands/dev.js";

test("planFrontendDevLaunch reuses preferred port when free", async () => {
  const plan = await planFrontendDevLaunch(5173, false);
  assert.deepEqual(plan, {
    port: 5173,
    requiresSpawn: true,
    reusedPreferred: true,
  });
});

test("planFrontendDevLaunch allocates fallback port when preferred port is busy", async () => {
  const plan = await planFrontendDevLaunch(
    5173,
    true,
    async () => ({ port: 4312, reusedPreferred: false }),
  );
  assert.equal(plan.requiresSpawn, true);
  assert.equal(plan.reusedPreferred, false);
  assert.equal(plan.port, 4312);
});

test("buildProjectFrontendCommandArgs injects Vite runtime port args for npm", () => {
  const args = buildProjectFrontendCommandArgs("npm", "dev", "vite", 4312);
  assert.deepEqual(args, [
    "run",
    "dev",
    "--",
    "--host",
    "127.0.0.1",
    "--port",
    "4312",
    "--strictPort",
  ]);
});

test("buildWorkspaceFrontendCommandArgs injects Vite runtime port args for npm workspaces", () => {
  const args = buildWorkspaceFrontendCommandArgs(
    "npm",
    "@acme/web",
    "apps/web",
    "dev",
    "vite",
    4400,
  );
  assert.deepEqual(args, [
    "--workspace",
    "apps/web",
    "run",
    "dev",
    "--",
    "--host",
    "127.0.0.1",
    "--port",
    "4400",
    "--strictPort",
  ]);
});

test("buildWorkspaceFrontendCommandArgs injects Vite runtime port args for yarn workspaces", () => {
  const args = buildWorkspaceFrontendCommandArgs(
    "yarn",
    "@acme/web",
    "apps/web",
    "dev",
    "vite",
    4400,
  );
  assert.deepEqual(args, [
    "workspace",
    "@acme/web",
    "run",
    "dev",
    "--host",
    "127.0.0.1",
    "--port",
    "4400",
    "--strictPort",
  ]);
});

test("buildProjectFrontendCommandArgs leaves non-vite scripts unchanged", () => {
  const args = buildProjectFrontendCommandArgs("npm", "start", "next", 3000);
  assert.deepEqual(args, ["run", "start"]);
});
