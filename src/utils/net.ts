import http from "node:http";
import net from "node:net";

/**
 * Wait until an HTTP server is responding on the given port.
 * Polls every 500ms until a successful response or timeout.
 */
export function waitForPort(port: number, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const check = (): void => {
      const req = http.get(`http://localhost:${port}`, (res) => {
        res.resume();
        resolve();
      });

      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timeout waiting for port ${port}`));
        } else {
          setTimeout(check, 500);
        }
      });

      req.end();
    };

    check();
  });
}

/**
 * Check whether a TCP port is already in use.
 */
export function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => resolve(true));
    server.once("listening", () => {
      server.close();
      resolve(false);
    });

    server.listen(port);
  });
}
