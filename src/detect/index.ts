import fs from "node:fs";
import path from "node:path";
import { detectMonorepo } from "./monorepo.js";
import { detectFrontend, isFrontendPackage, detectApiPrefixes } from "./frontend.js";
import {
  detectBackend,
  isBackendPackage,
  collectNativeDepsFromWorkspaces,
} from "./backend.js";
import { detectTopology } from "./topology.js";
import { analyzeTanstackStart } from "./tanstack-start.js";
import type { ProjectConfig, FrontendInfo, BackendInfo } from "../types.js";

/**
 * Scan a project directory and detect its full-stack structure.
 *
 * @param rootDir  Absolute path to the project root.
 * @returns A `ProjectConfig` describing the detected setup.
 * @throws If no frontend can be identified.
 */
export function detectProject(rootDir: string): ProjectConfig {
  const monorepo = detectMonorepo(rootDir);

  let frontend: FrontendInfo | null = null;
  let backend: BackendInfo | null = null;
  const frontendSearchedDirs: string[] = [];
  const backendSearchedDirs: string[] = [];

  // ---- Monorepo: scan each workspace package ------------------------------
  if (monorepo.type !== "none" && monorepo.workspaces.length > 0) {
    for (const ws of monorepo.workspaces) {
      if (!frontend && isFrontendPackage(rootDir, ws)) {
        frontend = detectFrontend(rootDir, ws);
      }
      if (!backend && isBackendPackage(rootDir, ws)) {
        backend = detectBackend(rootDir, ws);
      }
    }

    if (backend) {
      const wsNativeDeps = collectNativeDepsFromWorkspaces(
        rootDir,
        monorepo.workspaces,
      );
      backend.nativeDeps = [
        ...new Set([...backend.nativeDeps, ...wsNativeDeps]),
      ];
    }
  }

  // ---- Single package: check root -----------------------------------------
  if (!frontend && !backend) {
    frontendSearchedDirs.push(".");
    frontend = detectFrontend(rootDir, ".");
    backendSearchedDirs.push(".");
    backend = detectBackend(rootDir, ".");
  }

  // ---- Fallback: try common sub-directory names ---------------------------
  if (!frontend) {
    for (const dir of ["frontend", "client", "web", "app", "ui", "src/client"]) {
      frontendSearchedDirs.push(dir);
      frontend = detectFrontend(rootDir, dir);
      if (frontend) break;
    }
  }

  if (!backend) {
    for (const dir of ["backend", "server", "api", "src/server"]) {
      backendSearchedDirs.push(dir);
      backend = detectBackend(rootDir, dir);
      if (backend) break;
    }
  }

  // ---- Read project metadata from root package.json ----------------------
  const pkgJsonPath = path.join(rootDir, "package.json");
  let projectName = path.basename(rootDir);
  let version = "1.0.0";

  if (fs.existsSync(pkgJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
    projectName = (pkg.name as string)?.replace(/^@[^/]+\//, "") ?? projectName;
    version = (pkg.version as string) ?? version;
  }

  const safeName = projectName
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()
    .replace(/^(\d)/, "a$1");
  const appId = `com.${safeName || "app"}.app`;

  // ---- Validate -----------------------------------------------------------
  if (!frontend) {
    const searched =
      frontendSearchedDirs.length > 0
        ? `\nSearched: ${frontendSearchedDirs.join(", ")}`
        : "";
    throw new Error(
      `Could not detect a frontend framework.\n` +
        `Make sure your project has React, Vue, Svelte, or Angular as a dependency.\n` +
        `Detected monorepo: ${monorepo.type}${searched}`,
    );
  }
  backend ??= createFrontendOnlyBackend();

  let frontendResolved: FrontendInfo = frontend;
  const tanstackStart = analyzeTanstackStart(rootDir, frontendResolved);
  if (tanstackStart) {
    frontendResolved = { ...frontendResolved, tanstackStart };
    if (
      tanstackStart.isConfirmed &&
      tanstackStart.ineligibilityReasons.length === 0
    ) {
      const base = frontendResolved.path === "." ? "" : frontendResolved.path;
      frontendResolved = {
        ...frontendResolved,
        distDir: path.join(base, "dist", "client"),
      };
    }
  }

  // ---- Detect API prefixes for proxy ---------------------------------------
  if (backend.path.length > 0 && frontendResolved) {
    const proxyConfig = detectApiPrefixes(
      rootDir,
      frontendResolved.path,
      backend.path,
      backend.entry,
    );
    backend.apiPrefixes = proxyConfig.prefixes;
    if (proxyConfig.proxyRewrite) {
      backend.proxyRewrite = proxyConfig.proxyRewrite;
    }
  }

  // ---- Detect topology ----------------------------------------------------
  const { topology, evidence } = detectTopology(
    rootDir,
    backend.path,
    backend.entry,
    frontendResolved.path,
    frontendResolved.framework,
    frontendResolved.distDir,
    frontendResolved.tanstackStart ?? null,
  );

  return {
    name: projectName,
    appId,
    version,
    rootDir,
    monorepo,
    frontend: frontendResolved,
    backend,
    topology,
    topologyEvidence: evidence,
    electron: { window: { width: 1280, height: 860 } },
  };
}

function createFrontendOnlyBackend(): BackendInfo {
  return {
    framework: "unknown",
    path: "",
    entry: "",
    devCommand: "",
    devPort: 0,
    nativeDeps: [],
    healthCheckPath: "/",
  };
}
