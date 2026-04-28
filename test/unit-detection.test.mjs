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
  const serverFile = project.frontend.nextRuntime?.serverFile.replace(/\\/g, "/") ?? "";
  assert.match(serverFile, /\.next\/standalone\/(server\.js|[^/]+\/server\.js)$/);
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
  assert.equal(project.database?.provider, "sqlite");
  assert.equal(project.database?.driver, "better-sqlite3");
});

test("detects libsql client as native backend dependency", () => {
  const project = detectProject(fixturePath("libsql-native"));
  assert.ok(project.backend.nativeDeps.includes("@libsql/client"));
});

test("detects managed SQLite template database", () => {
  const project = detectProject(fixturePath("sqlite-managed-static"));
  assert.equal(project.database?.provider, "sqlite");
  assert.equal(project.database?.mode, "managed-local");
  assert.equal(project.database?.driver, "better-sqlite3");
  assert.equal(project.database?.templatePath, "data/seed.db");
});

test("detects Prisma SQLite migrations", () => {
  const project = detectProject(fixturePath("prisma-sqlite"));
  assert.equal(project.database?.driver, "prisma");
  assert.equal(project.database?.migrations?.tool, "prisma");
  assert.equal(project.database?.migrations?.path, "prisma/migrations");
  assert.equal(project.database?.migrations?.autoRun, false);
});

test("detects nested Prisma SQLite schema before generic sqlite deps", () => {
  const project = detectProject(fixturePath("prisma-nested-sqlite"));
  assert.equal(project.database?.driver, "prisma");
  assert.equal(project.database?.migrations?.tool, "prisma");
});

test("detects Drizzle SQLite migrations", () => {
  const project = detectProject(fixturePath("drizzle-sqlite"));
  assert.equal(project.database?.driver, "drizzle");
  assert.equal(project.database?.migrations?.tool, "drizzle");
  assert.equal(project.database?.migrations?.path, "drizzle");
});

test("does not create managed database config for PostgreSQL", () => {
  const project = detectProject(fixturePath("postgres-not-managed"));
  assert.equal(project.database, undefined);
});

test("does not choose a SQLite template when multiple candidates exist", () => {
  const project = detectProject(fixturePath("sqlite-multiple-templates"));
  assert.equal(project.database?.driver, "sqlite3");
  assert.equal(project.database?.templatePath, undefined);
  assert.ok(
    project.database?.warnings.some((warning) => /Multiple SQLite database files/.test(warning)),
  );
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
