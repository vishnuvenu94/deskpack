import fs from "node:fs";
import path from "node:path";

const MAX_HTML_WALK_DEPTH = 8;

/**
 * Whether a directory contains a usable static HTML entry for deskpack packaging.
 * Accepts root `index.html`, SPA shell `_shell.html`, root-level `*.html`, or nested prerender HTML.
 */
export function hasDeskpackStaticHtmlEntry(distPath: string): boolean {
  if (!fs.existsSync(distPath)) return false;

  const indexHtml = path.join(distPath, "index.html");
  const shellHtml = path.join(distPath, "_shell.html");
  if (fs.existsSync(indexHtml) || fs.existsSync(shellHtml)) return true;

  try {
    for (const name of fs.readdirSync(distPath)) {
      if (!name.endsWith(".html")) continue;
      const candidate = path.join(distPath, name);
      if (fs.statSync(candidate).isFile()) return true;
    }
  } catch {
    return false;
  }

  return hasNestedHtmlFile(distPath, 0);
}

function hasNestedHtmlFile(dir: string, depth: number): boolean {
  if (depth > MAX_HTML_WALK_DEPTH) return false;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(".html")) return true;
    if (entry.isDirectory() && hasNestedHtmlFile(full, depth + 1)) return true;
  }

  return false;
}

const SKIP_DIR_NAMES = new Set(["node_modules", ".git"]);

/**
 * Fail before packaging when the frontend build output is missing static HTML.
 */
export function assertDeskpackStaticHtmlOutput(distPath: string): void {
  if (!fs.existsSync(distPath)) {
    throw new Error(`Frontend dist not found at ${distPath}. Did the build succeed?`);
  }

  if (hasDeskpackStaticHtmlEntry(distPath)) return;

  throw new Error(
    `No usable static HTML found under ${distPath}. ` +
      `TanStack Start static builds should emit dist/client/index.html, dist/client/_shell.html (SPA shell), ` +
      `or prerendered *.html files. Plain Vite builds should emit dist/index.html.`,
  );
}
