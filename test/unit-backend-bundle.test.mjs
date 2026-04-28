import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { bundleBackend } from "../dist/build/backend.js";
import { copyRuntimeDependencies } from "../dist/build/runtime-deps.js";

function sampleConfig(projectDir) {
  return {
    name: "Bundle Test",
    appId: "com.bundle.test",
    version: "1.0.0",
    frontend: {
      path: ".",
      framework: "vite",
      buildCommand: "vite build",
      distDir: "dist",
      devPort: 5173,
    },
    backend: {
      path: ".",
      framework: "express",
      entry: "src/server.js",
      devPort: 3017,
      nativeDeps: [],
      healthCheckPath: "/health",
      apiPrefixes: ["/api"],
    },
    monorepo: {
      type: "none",
      packageManager: "npm",
    },
    topology: "backend-serves-frontend",
    topologyEvidence: {
      staticServingPatterns: [],
      ssrPatterns: [],
      staticRoot: null,
      frontendDistFound: true,
      warnings: [],
    },
    electron: {
      window: { width: 1200, height: 800 },
    },
    rootDir: projectDir,
  };
}

test("bundleBackend preserves backend-relative paths via nested module launcher", async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskpack-bundle-backend-"));
  const srcDir = path.join(projectDir, "src");
  const distDir = path.join(projectDir, "dist");
  const outDir = path.join(projectDir, ".deskpack", "desktop", "server");

  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(distDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(distDir, "index.html"), "<!doctype html><html><body>bundle test</body></html>\n");
  fs.writeFileSync(
    path.join(srcDir, "server.js"),
    [
      'import fs from "node:fs";',
      'import path from "node:path";',
      'import { fileURLToPath } from "node:url";',
      "",
      "const __dirname = path.dirname(fileURLToPath(import.meta.url));",
      'const indexPath = path.join(__dirname, "..", "dist", "index.html");',
      "const indexHtml = fs.readFileSync(indexPath, \"utf-8\");",
      'fs.writeFileSync(path.join(__dirname, "..", "resolved.txt"), indexHtml);',
      "",
    ].join("\n"),
  );

  copyDirSync(distDir, path.join(outDir, "dist"));

  await bundleBackend(projectDir, sampleConfig(projectDir), outDir);

  const launcherPath = path.join(outDir, "server.mjs");
  const nestedBundlePath = path.join(outDir, "src", "server.mjs");
  assert.ok(fs.existsSync(launcherPath));
  assert.ok(fs.existsSync(nestedBundlePath));
  assert.match(fs.readFileSync(launcherPath, "utf-8"), /import "\.\/src\/server\.mjs"/);

  const result = spawnSync(process.execPath, [launcherPath], {
    cwd: outDir,
    encoding: "utf-8",
  });
  assert.equal(result.status, 0, `${result.stdout || ""}${result.stderr || ""}`);
  assert.match(
    fs.readFileSync(path.join(outDir, "resolved.txt"), "utf-8"),
    /bundle test/,
  );
});

test("copyRuntimeDependencies copies Prisma generated client engines", () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskpack-prisma-runtime-"));
  const backendDir = path.join(projectDir, "backend");
  const prismaClientDir = path.join(backendDir, "node_modules", ".prisma", "client");
  const prismaPackageDir = path.join(backendDir, "node_modules", "@prisma", "client");
  const outDir = path.join(projectDir, ".deskpack", "desktop", "server");

  fs.mkdirSync(prismaClientDir, { recursive: true });
  fs.mkdirSync(prismaPackageDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(backendDir, "package.json"), JSON.stringify({ dependencies: { "@prisma/client": "5.22.0" } }));
  fs.writeFileSync(path.join(prismaClientDir, "package.json"), JSON.stringify({ name: ".prisma/client" }));
  fs.writeFileSync(path.join(prismaClientDir, "libquery_engine-darwin-arm64.dylib.node"), "engine");
  fs.writeFileSync(path.join(prismaPackageDir, "package.json"), JSON.stringify({ name: "@prisma/client" }));
  fs.writeFileSync(path.join(prismaPackageDir, "index.js"), "module.exports = {}");

  const config = sampleConfig(projectDir);
  config.backend.path = "backend";
  copyRuntimeDependencies(projectDir, config, outDir);

  assert.ok(
    fs.existsSync(
      path.join(outDir, "node_modules", ".prisma", "client", "libquery_engine-darwin-arm64.dylib.node"),
    ),
  );
  assert.ok(fs.existsSync(path.join(outDir, "node_modules", "@prisma", "client", "package.json")));
});

/** Mirrors libsql optional platform packages (see `libsql` package optionalDependencies). */
function libsqlOptionalPlatformPackageName() {
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "@libsql/darwin-arm64" : "@libsql/darwin-x64";
  }
  if (process.platform === "linux") {
    return process.arch === "arm64"
      ? "@libsql/linux-arm64-gnu"
      : "@libsql/linux-x64-gnu";
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return "@libsql/win32-x64-msvc";
  }
  return null;
}

test(
  "copyRuntimeDependencies copies libsql client and platform optional binary package",
  { skip: libsqlOptionalPlatformPackageName() === null },
  () => {
    const platformPkg = /** @type {string} */ (libsqlOptionalPlatformPackageName());

    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskpack-libsql-runtime-"));
    const backendDir = path.join(projectDir, "backend");
    const nodeModules = path.join(backendDir, "node_modules");
    const outDir = path.join(projectDir, ".deskpack", "desktop", "server");

    fs.mkdirSync(path.join(nodeModules, "@libsql", "client"), { recursive: true });
    fs.mkdirSync(path.join(nodeModules, "libsql"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "libsql-runtime-test", version: "1.0.0" }),
    );
    fs.writeFileSync(
      path.join(backendDir, "package.json"),
      JSON.stringify({ dependencies: { "@libsql/client": "1.0.0" } }),
    );

    const platformDir = path.join(nodeModules, ...platformPkg.split("/"));
    fs.mkdirSync(platformDir, { recursive: true });

    fs.writeFileSync(
      path.join(nodeModules, "@libsql", "client", "package.json"),
      JSON.stringify({
        name: "@libsql/client",
        version: "1.0.0",
        dependencies: { libsql: "1.0.0" },
      }),
    );
    fs.writeFileSync(
      path.join(nodeModules, "libsql", "package.json"),
      JSON.stringify({
        name: "libsql",
        version: "1.0.0",
        optionalDependencies: { [platformPkg]: "1.0.0" },
      }),
    );
    fs.writeFileSync(
      path.join(platformDir, "package.json"),
      JSON.stringify({ name: platformPkg, version: "1.0.0" }),
    );
    fs.writeFileSync(path.join(platformDir, "libsql.platform.node"), "native");

    fs.mkdirSync(outDir, { recursive: true });

    const config = sampleConfig(projectDir);
    config.backend.path = "backend";
    config.backend.nativeDeps = ["@libsql/client"];

    copyRuntimeDependencies(projectDir, config, outDir);

    assert.ok(
      fs.existsSync(path.join(outDir, "node_modules", "@libsql", "client", "package.json")),
    );
    assert.ok(fs.existsSync(path.join(outDir, "node_modules", "libsql", "package.json")));
    assert.ok(
      fs.existsSync(
        path.join(outDir, "node_modules", ...platformPkg.split("/"), "libsql.platform.node"),
      ),
    );
  },
);

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
