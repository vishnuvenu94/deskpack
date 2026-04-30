import Fastify from "fastify";

const app = Fastify();
app.get("/status", async () => ({ ok: true }));
