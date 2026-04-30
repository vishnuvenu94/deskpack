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
 * Wait for an HTTP endpoint to respond on one of the probe paths.
 */
export async function waitForHttpEndpoint(
  port: number,
  probePaths: string[],
  timeoutMs = 15_000,
): Promise<void> {
  const startedAt = Date.now();
  const normalized = uniqueProbePaths(probePaths.length > 0 ? probePaths : ["/"]);

  while (Date.now() - startedAt <= timeoutMs) {
    for (const probePath of normalized) {
      const ok = await probe(port, probePath);
      if (ok) return;
    }
    await sleep(350);
  }

  throw new Error(
    `After waiting ${Math.round(timeoutMs / 1000)}s nothing replied on port ${port} (paths: ${normalized.join(", ")}).\n\n` +
      `If another program is using that port, stop it or change the port in deskpack.config.json. ` +
      `If your dev server was still starting, wait until it prints ready and run deskpack dev again.`,
  );
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

/**
 * Select an available port. Uses `preferredPort` when possible, otherwise
 * allocates a free fallback port.
 */
export async function findAvailablePort(
  preferredPort: number,
): Promise<{ port: number; reusedPreferred: boolean }> {
  if (preferredPort > 0 && !(await isPortInUse(preferredPort))) {
    return { port: preferredPort, reusedPreferred: true };
  }

  const fallback = await allocateEphemeralPort();
  return { port: fallback, reusedPreferred: false };
}

function allocateEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.once("listening", () => {
      const address = server.address();
      const port =
        typeof address === "object" && address
          ? address.port
          : 0;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        if (!port) {
          reject(new Error("Failed to allocate a free port."));
          return;
        }
        resolve(port);
      });
    });

    server.listen(0, "127.0.0.1");
  });
}

function probe(port: number, probePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: probePath,
        timeout: 1200,
      },
      (res) => {
        res.resume();
        resolve(Boolean(res.statusCode && res.statusCode < 500));
      },
    );

    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

function uniqueProbePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of paths) {
    const normalized = value.startsWith("/") ? value : `/${value}`;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
