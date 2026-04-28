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

test("detects Next static export with custom distDir", () => {
  const project = detectProject(fixturePath("next-static-export-custom-distdir"));
  assert.equal(project.frontend.framework, "next");
  assert.equal(project.topology, "frontend-only-static");
  assert.equal(project.frontend.distDir, "dist");
});

test("detects Next SSR/server runtime as unsupported", () => {
  const project = detectProject(fixturePath("next-ssr-unsupported"));
  assert.equal(project.frontend.framework, "next");
  assert.equal(project.topology, "ssr-framework");
});

test("detects Next standalone runtime as supported", () => {
  const project = detectProject(fixturePath("next-standalone-runtime"));
  assert.equal(project.frontend.framework, "next");
  assert.equal(project.topology, "next-standalone-runtime");
  assert.equal(project.frontend.nextRuntime?.mode, "standalone");
  assert.ok(
    project.frontend.nextRuntime?.serverFile.replace(/\\/g, "/").endsWith(".next/standalone/server.js"),
  );
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

test("detects tRPC API prefix when Vite proxy config is absent", () => {
  const project = detectProject(fixturePath("trpc-fullstack"));
  assert.ok(project.backend.apiPrefixes?.includes("/trpc"));
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

test("TanStack Start SPA static mode is frontend-only with dist/client", () => {
  const project = detectProject(fixturePath("tanstack-start-spa-static"));
  assert.equal(project.topology, "frontend-only-static");
  assert.ok(project.frontend.tanstackStart?.isConfirmed);
  assert.equal(project.frontend.tanstackStart?.spaEnabled, true);
  assert.equal(project.frontend.tanstackStart?.ineligibilityReasons.length, 0);
  assert.ok(
    project.frontend.distDir.replace(/\\/g, "/").endsWith("dist/client"),
  );
});

test("TanStack Start prerender static mode is supported", () => {
  const project = detectProject(fixturePath("tanstack-start-prerender-static"));
  assert.equal(project.topology, "frontend-only-static");
  assert.ok(project.frontend.tanstackStart?.isConfirmed);
  assert.equal(project.frontend.tanstackStart?.prerenderEnabled, true);
  assert.equal(project.frontend.tanstackStart?.ineligibilityReasons.length, 0);
});

test("TanStack Start runtime server routes block static packaging", () => {
  const project = detectProject(fixturePath("tanstack-start-runtime-api"));
  assert.equal(project.topology, "ssr-framework");
  assert.ok(project.frontend.tanstackStart?.isConfirmed);
  assert.ok(
    project.topologyEvidence.warnings.some((w) =>
      /server\.handlers|handlers/i.test(w),
    ),
  );
});

test("TanStack Start Node/Nitro runtime is supported", () => {
  const project = detectProject(fixturePath("tanstack-start-nitro-runtime"));
  assert.equal(project.topology, "tanstack-start-runtime");
  assert.ok(project.frontend.tanstackStart?.isConfirmed);
  assert.equal(project.frontend.tanstackStart?.mode, "node-runtime");
  assert.equal(project.frontend.tanstackStart?.runtime?.serverFile, ".output/server/index.mjs");
  assert.equal(project.frontend.tanstackStart?.ineligibilityReasons.length, 0);
});

test("TanStack Start without spa/prerender is unsupported", () => {
  const project = detectProject(fixturePath("tanstack-start-no-static"));
  assert.equal(project.topology, "ssr-framework");
  assert.ok(project.frontend.tanstackStart?.isConfirmed);
  assert.ok(
    project.topologyEvidence.warnings.some((w) =>
      /SPA|prerender|static prerendering/i.test(w),
    ),
  );
});
