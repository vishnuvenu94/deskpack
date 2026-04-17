import http from "node:http";

const port = Number(process.env.PORT || 3010);
http
  .createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  })
  .listen(port, "127.0.0.1");
