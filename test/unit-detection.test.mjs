import assert from "node:assert/strict";
import test from "node:test";
import { detectProject } from "../dist/detect/index.js";
import { fixturePath } from "./helpers.mjs";

test("detects frontend-only static topology", () => {
  const project = detectProject(fixturePath("frontend-only-static"));
  assert.equal(project.topology, "frontend-only-static");
  assert.equal(project.backend.path, "");
  assert.equal(project.frontend.framework, "vite");
});

test("detects backend-serves-frontend topology", () => {
  const project = detectProject(fixturePath("backend-serves-frontend"));
  assert.equal(project.topology, "backend-serves-frontend");
  assert.equal(project.backend.framework, "hono");
});

test("detects separate frontend + API topology", () => {
  const project = detectProject(fixturePath("frontend-api-separate"));
  assert.equal(project.topology, "frontend-static-separate");
  assert.equal(project.frontend.path, "frontend");
  assert.equal(project.backend.path, "backend");
});

test("detects Next static export as supported", () => {
  const project = detectProject(fixturePath("next-static-export"));
  assert.equal(project.frontend.framework, "next");
  assert.equal(project.topology, "frontend-static-separate");
});

test("detects Next SSR/server runtime as unsupported", () => {
  const project = detectProject(fixturePath("next-ssr-unsupported"));
  assert.equal(project.frontend.framework, "next");
  assert.equal(project.topology, "ssr-framework");
});

test("detects monorepo workspace frontend/backend", () => {
  const project = detectProject(fixturePath("monorepo-npm"));
  assert.equal(project.monorepo.type, "npm");
  assert.equal(project.frontend.path, "apps/web");
  assert.equal(project.backend.path, "apps/api");
});

test("detects monorepo Vite proxy rewrite", () => {
  const project = detectProject(fixturePath("monorepo-npm"));
  assert.deepStrictEqual(project.backend.apiPrefixes, ["/api"]);
  assert.equal(project.backend.proxyRewrite, "/api");
});

test("detects native backend dependencies", () => {
  const project = detectProject(fixturePath("native-dependency"));
  assert.ok(project.backend.nativeDeps.includes("better-sqlite3"));
});

test("detects hardcoded Nest backend port and health route", () => {
  const project = detectProject(fixturePath("nest-hardcoded-port"));
  assert.equal(project.topology, "frontend-static-separate");
  assert.equal(project.backend.framework, "nestjs");
  assert.equal(project.backend.devPort, 3300);
  assert.equal(project.backend.healthCheckPath, "/health");
});
