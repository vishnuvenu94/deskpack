import http from "node:http"

const port = Number(process.env.PORT || 5173)
http
  .createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" })
    res.end("tanstack start dev")
  })
  .listen(port, "127.0.0.1", () => {
    process.stdout.write("listening " + port + "\n")
  })
