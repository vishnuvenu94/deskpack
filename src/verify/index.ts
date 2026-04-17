import http from "node:http";
import { ChildProcess, fork } from "child_process";
import type { DeskpackConfig } from "../types.js";

export interface ProbeResult {
  /** Whether the probe succeeded */
  success: boolean;
  /** HTTP status code if available */
  statusCode?: number;
  /** Content type if available */
  contentType?: string;
  /** Whether the response appears to be an HTML page */
  isHtml: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Probe a URL and return information about the response.
 */
export function probeUrl(url: string, timeoutMs = 5000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ success: false, error: "Timeout", isHtml: false });
    }, timeoutMs);

    const req = http.get(url, (res) => {
      clearTimeout(timeout);
      let data = "";

      res.on("data", (chunk) => {
        data += chunk.toString();
        // Only need first 1KB to check if HTML
        if (data.length > 1024) {
          res.destroy();
        }
      });

      res.on("end", () => {
        clearTimeout(timeout);
        const contentType = res.headers["content-type"] ?? "";
        const isHtml =
          contentType.includes("text/html") ||
          (data.trim().startsWith("<") && data.includes("<!DOCTYPE"));

        resolve({
          success: res.statusCode !== undefined && res.statusCode < 500,
          statusCode: res.statusCode,
          contentType,
          isHtml,
        });
      });

      res.on("error", (err) => {
        clearTimeout(timeout);
        resolve({ success: false, error: err.message, isHtml: false });
      });
    });

    req.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ success: false, error: err.message, isHtml: false });
    });
  });
}

/**
 * Start the backend server for verification.
 *
 * Returns the spawned process and a cleanup function.
 */
export async function startBackendForVerification(
  config: DeskpackConfig,
  serverFilePath: string,
): Promise<{
  process: ChildProcess;
  port: number;
  cleanup: () => void;
}> {
  const port = config.backend.devPort;

  // Start the server using the bundled server.mjs
  const apiProcess = fork(serverFilePath, [], {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "production",
    },
    stdio: ["pipe", "pipe", "pipe", "ipc"],
  });

  const cleanup = (): void => {
    apiProcess.kill("SIGTERM");
    setTimeout(() => {
      if (!apiProcess.killed) {
        apiProcess.kill("SIGKILL");
      }
    }, 3000);
  };

  // Wait for the server to be ready
  await waitForServerStart(port, 30000);

  return { process: apiProcess, port, cleanup };
}

/**
 * Wait for a server to start accepting connections.
 */
function waitForServerStart(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = (): void => {
      const req = http.get(`http://localhost:${port}`, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolve();
        } else {
          if (Date.now() - start > timeoutMs) {
            reject(new Error("Timeout waiting for server"));
          } else {
            setTimeout(check, 300);
          }
        }
      });

      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error("Timeout waiting for server"));
        } else {
          setTimeout(check, 300);
        }
      });

      req.end();
    };

    check();
  });
}

export interface VerificationResult {
  /** Whether verification passed */
  passed: boolean;
  /** The topology that was verified */
  verifiedTopology: string;
  /** Whether the backend is serving the frontend */
  backendServesFrontend: boolean;
  /** Whether the frontend is accessible */
  frontendAccessible: boolean;
  /** Probe results for different endpoints */
  probes: {
    root: ProbeResult;
    indexHtml: ProbeResult;
    api?: ProbeResult;
  };
  /** Errors if verification failed */
  errors: string[];
}

/**
 * Verify the runtime behavior of the packaged app.
 *
 * This is the definitive check that determines if the app will work
 * in production. If this fails, deskpack should not package the app.
 */
export async function verifyRuntime(
  config: DeskpackConfig,
  serverFilePath: string,
  frontendDistPath: string,
): Promise<VerificationResult> {
  const errors: string[] = [];
  let backendServesFrontend = false;
  let frontendAccessible = false;

  let apiProcess: ChildProcess | null = null;
  let cleanup: (() => void) | null = null;

  try {
    // Start the backend
    const { process, port, cleanup: c } = await startBackendForVerification(
      config,
      serverFilePath,
    );
    apiProcess = process;
    cleanup = c;

    // Probe /
    const rootProbe = await probeUrl(`http://localhost:${port}/`);
    const probes = {
      root: rootProbe,
      indexHtml: rootProbe, // If root serves index.html, same probe
      api: undefined,
    };

    // Check if root returns HTML (indicates frontend is being served)
    if (rootProbe.isHtml) {
      backendServesFrontend = true;
      frontendAccessible = true;
    }

    // Probe /index.html directly if it exists in the dist
    const indexHtmlPath = `${frontendDistPath}/index.html`;
    if (fs.existsSync(indexHtmlPath) && !backendServesFrontend) {
      // Try to access via backend if it serves static files from that path
      const indexProbe = await probeUrl(`http://localhost:${port}/index.html`);
      probes.indexHtml = indexProbe;
      if (indexProbe.isHtml) {
        backendServesFrontend = true;
        frontendAccessible = true;
      }
    }

    // Determine verified topology
    let verifiedTopology = config.topology;
    if (config.topology === "unsupported" || config.topology === "ssr-framework") {
      if (backendServesFrontend) {
        verifiedTopology = "backend-serves-frontend";
      } else {
        verifiedTopology = "frontend-static-separate";
      }
    }

    // Final verification
    if (config.topology === "backend-serves-frontend" && !backendServesFrontend) {
      errors.push(
        "Detection indicated backend serves frontend, but runtime verification failed",
      );
    }

    return {
      passed: errors.length === 0,
      verifiedTopology,
      backendServesFrontend,
      frontendAccessible,
      probes,
      errors,
    };
  } catch (err) {
    errors.push(`Runtime verification failed: ${err instanceof Error ? err.message : String(err)}`);
    return {
      passed: false,
      verifiedTopology: config.topology,
      backendServesFrontend: false,
      frontendAccessible: false,
      probes: {
        root: { success: false, isHtml: false, error: String(err) },
        indexHtml: { success: false, isHtml: false, error: String(err) },
      },
      errors,
    };
  } finally {
    if (cleanup) {
      cleanup();
    }
  }
}

// We need fs for the verification function
import fs from "node:fs";
