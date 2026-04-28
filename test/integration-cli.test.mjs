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

test("deskpack build --skip-package copies managed SQLite database assets", () => {
  const projectDir = copyFixtureToTemp("sqlite-managed-static");

  const initResult = runCli(["init", "--yes", "--force"], projectDir, {
    DESKPACK_SKIP_ELECTRON_INSTALL: "1",
  });
  assert.equal(initResult.status, 0, commandOutput(initResult));

  const config = JSON.parse(
    fs.readFileSync(path.join(projectDir, "deskpack.config.json"), "utf-8"),
  );
  assert.equal(config.database.provider, "sqlite");
  assert.equal(config.database.templatePath, "data/seed.db");

  const mainCjs = fs.readFileSync(
    path.join(projectDir, ".deskpack", "desktop", "main.cjs"),
    "utf-8",
  );
  assert.match(mainCjs, /prepareManagedSqliteDatabase/);
  assert.match(mainCjs, /DESKPACK_DB_PATH/);
  assert.match(mainCjs, /DATABASE_URL/);

  const buildResult = runCli(["build", "--skip-package"], projectDir);
  assert.equal(buildResult.status, 0, commandOutput(buildResult));

  const databaseDir = path.join(projectDir, ".deskpack", "desktop", "server", "database");
  assert.ok(fs.existsSync(path.join(databaseDir, "template.db")));
  assert.equal(
    fs.readFileSync(path.join(databaseDir, "template.db"), "utf-8"),
    "seed sqlite template\n",
  );
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

test("deskpack init writes proxyRewrite for npm workspace with Vite rewrite", () => {
  const projectDir = copyFixtureToTemp("monorepo-npm");

  const result = runCli(["init", "--yes", "--force"], projectDir, {
    DESKPACK_SKIP_ELECTRON_INSTALL: "1",
  });

  assert.equal(result.status, 0, commandOutput(result));

  const config = JSON.parse(
    fs.readFileSync(path.join(projectDir, "deskpack.config.json"), "utf-8"),
  );
  assert.deepStrictEqual(config.backend.apiPrefixes, ["/api"]);
  assert.equal(config.backend.proxyRewrite, "/api");

  const mainCjs = fs.readFileSync(
    path.join(projectDir, ".deskpack", "desktop", "main.cjs"),
    "utf-8",
  );
  assert.match(mainCjs, /PROXY_REWRITE = "\/api"/);
  assert.match(mainCjs, /function applyProxyRewrite/);
});

test("deskpack init detects tRPC API prefix without Vite proxy config", () => {
  const projectDir = copyFixtureToTemp("trpc-fullstack");

  const result = runCli(["init", "--yes", "--force"], projectDir, {
    DESKPACK_SKIP_ELECTRON_INSTALL: "1",
  });

  assert.equal(result.status, 0, commandOutput(result));

  const config = JSON.parse(
    fs.readFileSync(path.join(projectDir, "deskpack.config.json"), "utf-8"),
  );
  assert.ok(Array.isArray(config.backend.apiPrefixes));
  assert.ok(config.backend.apiPrefixes.includes("/trpc"));
});

test("deskpack init refuses Next SSR/server runtime projects early", () => {
  const projectDir = copyFixtureToTemp("next-ssr-unsupported");

  const result = runCli(["init", "--yes"], projectDir, {
    DESKPACK_SKIP_ELECTRON_INSTALL: "1",
  });
  const output = commandOutput(result);

  assert.notEqual(result.status, 0, output);
  assert.match(output, /standalone|static export|output:\s*"export"/i);
});

test("deskpack build --skip-package copies Next standalone runtime", () => {
  const projectDir = copyFixtureToTemp("next-standalone-runtime");

  const initResult = runCli(["init", "--yes", "--force"], projectDir, {
    DESKPACK_SKIP_ELECTRON_INSTALL: "1",
  });
  assert.equal(initResult.status, 0, commandOutput(initResult));

  const buildResult = runCli(["build", "--skip-package"], projectDir);
  assert.equal(buildResult.status, 0, commandOutput(buildResult));

  const nextDir = path.join(projectDir, ".deskpack", "desktop", "server", "next");
  const serverFile = path.join(nextDir, "server.js");
  assert.ok(fs.existsSync(serverFile));
  assert.ok(fs.existsSync(path.join(nextDir, ".next", "static", "chunks", "main.js")));
  assert.ok(fs.existsSync(path.join(nextDir, "public", "hello.txt")));
  assert.match(fs.readFileSync(serverFile, "utf-8"), /next standalone ssr/);
});

test("deskpack init refuses TanStack Start without static mode", () => {
  const projectDir = copyFixtureToTemp("tanstack-start-no-static");

  const result = runCli(["init", "--yes"], projectDir, {
    DESKPACK_SKIP_ELECTRON_INSTALL: "1",
  });
  const output = commandOutput(result);

  assert.notEqual(result.status, 0, output);
  assert.match(output, /TanStack Start|SPA|prerender/i, output);
});

test("deskpack init refuses TanStack Start with runtime server routes", () => {
  const projectDir = copyFixtureToTemp("tanstack-start-runtime-api");

  const result = runCli(["init", "--yes"], projectDir, {
    DESKPACK_SKIP_ELECTRON_INSTALL: "1",
  });
  const output = commandOutput(result);

  assert.notEqual(result.status, 0, output);
  assert.match(output, /server\.handlers|handlers|runtime/i, output);
});

test("deskpack build copies TanStack SPA shell dist/client to web-dist", () => {
  const projectDir = copyFixtureToTemp("tanstack-start-spa-static");

  const initResult = runCli(["init", "--yes", "--force"], projectDir, {
    DESKPACK_SKIP_ELECTRON_INSTALL: "1",
  });
  assert.equal(initResult.status, 0, commandOutput(initResult));

  const buildResult = runCli(["build", "--skip-package"], projectDir);
  assert.equal(buildResult.status, 0, commandOutput(buildResult));

  const webDist = path.join(projectDir, ".deskpack", "desktop", "server", "web-dist");
  assert.ok(fs.existsSync(path.join(webDist, "_shell.html")));
  assert.equal(fs.existsSync(path.join(webDist, "index.html")), false);
});

test("deskpack build copies TanStack prerender dist/client to web-dist", () => {
  const projectDir = copyFixtureToTemp("tanstack-start-prerender-static");

  const initResult = runCli(["init", "--yes", "--force"], projectDir, {
    DESKPACK_SKIP_ELECTRON_INSTALL: "1",
  });
  assert.equal(initResult.status, 0, commandOutput(initResult));

  const buildResult = runCli(["build", "--skip-package"], projectDir);
  assert.equal(buildResult.status, 0, commandOutput(buildResult));

  const webDist = path.join(projectDir, ".deskpack", "desktop", "server", "web-dist");
  assert.ok(fs.existsSync(path.join(webDist, "index.html")));
  assert.ok(fs.existsSync(path.join(webDist, "blog", "post", "index.html")));
});

test("deskpack build recovers Next custom distDir from stale config", () => {
  const projectDir = copyFixtureToTemp("next-static-export-custom-distdir");

  const initResult = runCli(["init", "--yes", "--force"], projectDir, {
    DESKPACK_SKIP_ELECTRON_INSTALL: "1",
  });
  assert.equal(initResult.status, 0, commandOutput(initResult));

  const configPath = path.join(projectDir, "deskpack.config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  config.frontend.distDir = "out";
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  const buildResult = runCli(["build", "--skip-package"], projectDir);
  assert.equal(buildResult.status, 0, commandOutput(buildResult));

  const webDist = path.join(projectDir, ".deskpack", "desktop", "server", "web-dist");
  assert.ok(fs.existsSync(path.join(webDist, "index.html")));
});

test("deskpack build --skip-package works for backend-serves-frontend topology", () => {
  const projectDir = copyFixtureToTemp("backend-serves-frontend");

  const initResult = runCli(["init", "--yes", "--force"], projectDir, {
    DESKPACK_SKIP_ELECTRON_INSTALL: "1",
  });
  assert.equal(initResult.status, 0, commandOutput(initResult));

  const buildResult = runCli(["build", "--skip-package"], projectDir);
  assert.equal(buildResult.status, 0, commandOutput(buildResult));

  const serverDir = path.join(projectDir, ".deskpack", "desktop", "server");
  assert.ok(fs.existsSync(path.join(serverDir, "web-dist", "index.html")));
  assert.ok(fs.existsSync(path.join(serverDir, "dist", "index.html")));
  // Backend resolves relative to __dirname (../ after bundling into server/src/)
  assert.ok(fs.existsSync(path.join(serverDir, "index.html")));
  assert.ok(fs.existsSync(path.join(serverDir, "src", "server.mjs")));
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
