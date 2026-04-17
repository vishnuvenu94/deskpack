import fs from "node:fs";
import path from "node:path";

export interface BuildArtifactInfo {
  /** Path to the frontend dist directory */
  distPath: string;
  /** Whether index.html was found */
  hasIndexHtml: boolean;
  /** Whether this looks like a static SPA (index.html + static assets) */
  isStaticSpa: boolean;
  /** Whether this looks like a static export (Next.js static, etc.) */
  isStaticExport: boolean;
  /** Whether this looks like an SSR output (server bundle present) */
  isSsrOutput: boolean;
  /** List of JS/CSS files found in the output */
  assets: string[];
  /** Warnings about the build output */
  warnings: string[];
}

/**
 * Inspect the frontend build output to determine what was produced.
 *
 * This provides a deterministic signal that can be used to verify
 * the detected topology matches reality.
 */
export function inspectBuildArtifacts(
  rootDir: string,
  frontendPath: string,
  distDir: string,
): BuildArtifactInfo {
  const distPath = path.resolve(rootDir, frontendPath, distDir);
  const warnings: string[] = [];
  const assets: string[] = [];

  const result: BuildArtifactInfo = {
    distPath,
    hasIndexHtml: false,
    isStaticSpa: false,
    isStaticExport: false,
    isSsrOutput: false,
    assets: [],
    warnings,
  };

  if (!fs.existsSync(distPath)) {
    warnings.push(`Dist directory not found at ${distPath}`);
    return result;
  }

  // Check for index.html
  const indexHtmlPath = path.join(distPath, "index.html");
  result.hasIndexHtml = fs.existsSync(indexHtmlPath);

  // Check for static assets
  const staticDir = path.join(distPath, "static");
  const assetsDir = path.join(distPath, "assets");
  const _buildDir = path.join(distPath, "_next"); // Next.js static export

  const hasStaticDir = fs.existsSync(staticDir);
  const hasAssetsDir = fs.existsSync(assetsDir);
  const hasNextStatic = fs.existsSync(_buildDir);

  // Check for server-side output (SSR)
  const serverDir = path.join(distPath, "server");
  const hasServerDir = fs.existsSync(serverDir);

  if (hasServerDir) {
    result.isSsrOutput = true;
    warnings.push("SSR output detected - this may require different packaging");
  }

  // Check for Next.js static export markers
  if (hasNextStatic) {
    const nextDir = path.join(_buildDir, "chunks", "pages");
    if (fs.existsSync(nextDir)) {
      result.isStaticExport = true;
    }
  }

  // Determine if this is a static SPA
  if (result.hasIndexHtml && (hasStaticDir || hasAssetsDir || !hasServerDir)) {
    result.isStaticSpa = true;
  }

  // Collect asset files
  collectAssets(distPath, assets);

  // Limit to reasonable number
  result.assets = assets.slice(0, 50);
  if (assets.length > 50) {
    warnings.push(`Found ${assets.length} assets, showing first 50`);
  }

  // Validate the output matches expectations
  if (result.hasIndexHtml && !result.isStaticSpa && !result.isStaticExport) {
    warnings.push("index.html found but doesn't look like a standard static SPA");
  }

  if (!result.hasIndexHtml && !result.isSsrOutput) {
    warnings.push("No index.html found - this may be an API-only output");
  }

  return result;
}

/**
 * Recursively collect asset file paths from a directory.
 */
function collectAssets(dir: string, files: string[]): void {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip hidden directories and common non-asset dirs
      if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
        collectAssets(fullPath, files);
      }
    } else if (entry.isFile()) {
      // Include JS, CSS, images, fonts
      if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|webp)$/.test(entry.name)) {
        files.push(path.relative(dir, fullPath));
      }
    }
  }
}

/**
 * Verify that the build output matches the expected topology.
 *
 * Returns null if verification passes, or an error message if it fails.
 */
export function verifyBuildOutput(
  rootDir: string,
  frontendPath: string,
  distDir: string,
  expectedTopology: string,
): string | null {
  const artifacts = inspectBuildArtifacts(rootDir, frontendPath, distDir);

  if (expectedTopology === "frontend-static-separate") {
    if (!artifacts.hasIndexHtml) {
      return `Expected static frontend output (index.html) but found none at ${artifacts.distPath}`;
    }
    if (artifacts.isSsrOutput) {
      return `Expected static frontend output but found SSR server bundle`;
    }
  }

  if (expectedTopology === "frontend-only-static") {
    if (!artifacts.hasIndexHtml) {
      return `Expected static frontend output but found none`;
    }
  }

  if (expectedTopology === "ssr-framework") {
    if (!artifacts.isSsrOutput) {
      return `Expected SSR output but found static export instead`;
    }
  }

  // If we have warnings, log them but don't fail
  for (const warning of artifacts.warnings) {
    console.warn(`[shipdesk] Build verification: ${warning}`);
  }

  return null;
}
