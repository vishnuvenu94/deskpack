import http from "node:http";

const port = Number(process.env.PORT || 5173);
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end("<!doctype html><html><body>dev</body></html>");
});

server.listen(port, "127.0.0.1", () => {
  console.log("frontend dev ready on " + port);
});
