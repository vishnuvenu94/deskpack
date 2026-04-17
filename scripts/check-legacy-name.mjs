import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const LEGACY_PATTERN = /shipdesk/i;
const ALLOWED_HISTORY_FILES = new Set(["CHANGELOG.md"]);
const SKIP_PATH_PREFIXES = ["test/", "scripts/check-legacy-name.mjs"];
const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  ".deskpack",
  ".shipdesk",
]);
const SCANNED_EXTENSIONS = new Set([
  ".ts",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".toml",
  ".txt",
  ".sh",
]);

const files = listFiles(ROOT_DIR);
const violations = [];

for (const filePath of files) {
  const relativePath = path.relative(ROOT_DIR, filePath).replace(/\\/g, "/");
  if (SKIP_PATH_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) {
    continue;
  }
  if (ALLOWED_HISTORY_FILES.has(relativePath)) continue;
  if (!shouldScan(filePath)) continue;

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  lines.forEach((line, index) => {
    if (LEGACY_PATTERN.test(line)) {
      violations.push(`${relativePath}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (violations.length > 0) {
  console.error("Found legacy name references (`shipdesk`):");
  for (const violation of violations) {
    console.error("  " + violation);
  }
  process.exit(1);
}

console.log("Legacy naming check passed.");

function listFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      result.push(...listFiles(fullPath));
    } else if (entry.isFile()) {
      result.push(fullPath);
    }
  }

  return result;
}

function shouldScan(filePath) {
  const extension = path.extname(filePath);
  if (SCANNED_EXTENSIONS.has(extension)) return true;
  const baseName = path.basename(filePath);
  return baseName === "Dockerfile";
}
