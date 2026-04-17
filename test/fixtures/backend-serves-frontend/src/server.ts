// Topology fixture: backend serves static frontend files.
import path from "node:path";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";

const app = new Hono();
app.use("/*", serveStatic({ root: path.join(process.cwd(), "dist") }));
app.get("/health", (c) => c.text("ok"));

export default app;
