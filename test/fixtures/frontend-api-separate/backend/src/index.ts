import http from "node:http";

const port = Number(process.env.PORT || 3300);
const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "api" }));
});

server.listen(port, "127.0.0.1", () => {
  console.log("api ready on " + port);
});
