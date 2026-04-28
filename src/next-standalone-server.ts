import fs from "node:fs";
import path from "node:path";

/**
 * Next may emit `server.js` at `.next/standalone/server.js` or nested as
 * `.next/standalone/<project>/server.js`. Find the app entry `server.js`
 * (not packages under `node_modules`).
 */
export function findStandaloneServerJsFile(standaloneDirAbsolute: string): string | null {
  if (!fs.existsSync(standaloneDirAbsolute) || !fs.statSync(standaloneDirAbsolute).isDirectory()) {
    return null;
  }

  const flat = path.join(standaloneDirAbsolute, "server.js");
  if (fs.existsSync(flat)) return flat;

  let entries: string[];
  try {
    entries = fs.readdirSync(standaloneDirAbsolute);
  } catch {
    return null;
  }

  const nested: string[] = [];
  for (const name of entries) {
    if (name === "node_modules") continue;
    const sub = path.join(standaloneDirAbsolute, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(sub);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const nestedServer = path.join(sub, "server.js");
    if (fs.existsSync(nestedServer)) nested.push(nestedServer);
  }

  if (nested.length === 1) return nested[0];
  if (nested.length === 0) return null;

  nested.sort((a, b) => a.split(path.sep).length - b.split(path.sep).length);
  return nested[0] ?? null;
}
