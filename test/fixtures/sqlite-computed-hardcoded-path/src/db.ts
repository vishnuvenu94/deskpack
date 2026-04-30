import Database from "better-sqlite3";
import path from "node:path";

const rootDir = process.cwd();
const dataDir = path.join(rootDir, "data");
const dbPath = path.join(dataDir, "app.db");

export const sqlite = new Database(dbPath);
