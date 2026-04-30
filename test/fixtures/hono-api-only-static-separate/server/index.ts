import http from "node:http";

const app = {
  route(_prefix: string, _router: unknown) {},
};

app.route("/api", {});

const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/api")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(Number(process.env.PORT) || 3000);
