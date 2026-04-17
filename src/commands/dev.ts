import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import chalk from "chalk";
import { loadConfig } from "../config.js";
import { isPortInUse } from "../utils/net.js";
import { log } from "../utils/logger.js";

/**
 * `shipdesk dev`
 *
 * 1. Start the project's dev servers (if not already running).
 * 2. Wait for the frontend port to become available.
 * 3. Launch Electron pointing at the Vite / Webpack dev server.
 */
export async function devCommand(rootDir: string): Promise<void> {
  log.banner();
  const config = loadConfig(rootDir);

  const desktopDir = path.join(rootDir, ".shipdesk", "desktop");
  if (!fs.existsSync(path.join(desktopDir, "node_modules", "electron"))) {
    log.error(
      `Electron not installed. Run ${chalk.cyan("npx shipdesk init")} first.`,
    );
    process.exit(1);
  }

  log.info("Starting development mode…");
  log.blank();

  // --- Start dev servers (if needed) ---------------------------------------
  let devProcesses: ChildProcess[] = [];

  const frontendUp = await isPortInUse(config.frontend.devPort);
  const backendUp = await isPortInUse(config.backend.devPort);

  if (!frontendUp || !backendUp) {
    const pm = config.monorepo.packageManager;

    if (config.monorepo.type !== "none") {
      // Monorepo: start frontend and backend separately using workspace commands
      const frontendPkgPath = path.join(rootDir, config.frontend.path, "package.json");
      const backendPkgPath = path.join(rootDir, config.backend.path, "package.json");

      if (!frontendUp) {
        const frontendPkg = JSON.parse(fs.readFileSync(frontendPkgPath, "utf-8"));
        const frontendDevCmd = frontendPkg.scripts?.dev ?? frontendPkg.scripts?.start ?? "dev";
        log.step("Starting frontend dev…", `${pm} run ${frontendDevCmd}`);

        let args: string[];
        if (pm === "pnpm") {
          args = ["--filter", frontendPkg.name, "run", frontendDevCmd];
        } else if (pm === "yarn") {
          args = ["workspace", frontendPkg.name, "run", frontendDevCmd];
        } else {
          args = ["--workspace", config.frontend.path, "run", frontendDevCmd];
        }

        const feProcess = spawn(pm, args, { cwd: rootDir, stdio: "pipe", shell: true });
        feProcess.stdout?.on("data", (d: Buffer) => process.stdout.write(d));
        feProcess.stderr?.on("data", (d: Buffer) => process.stderr.write(d));
        devProcesses.push(feProcess);
      }

      if (!backendUp) {
        const backendPkg = JSON.parse(fs.readFileSync(backendPkgPath, "utf-8"));
        const backendDevCmd = backendPkg.scripts?.dev ?? backendPkg.scripts?.start ?? "dev";
        log.step("Starting backend dev…", `${pm} run ${backendDevCmd}`);

        let args: string[];
        if (pm === "pnpm") {
          args = ["--filter", backendPkg.name, "run", backendDevCmd];
        } else if (pm === "yarn") {
          args = ["workspace", backendPkg.name, "run", backendDevCmd];
        } else {
          args = ["--workspace", config.backend.path, "run", backendDevCmd];
        }

        const beProcess = spawn(pm, args, { cwd: rootDir, stdio: "pipe", shell: true });
        beProcess.stdout?.on("data", (d: Buffer) => process.stdout.write(d));
        beProcess.stderr?.on("data", (d: Buffer) => process.stderr.write(d));
        devProcesses.push(beProcess);
      }
    } else {
      // Single package or non-mono: use single dev command from root
      log.step("Starting dev servers…", `${pm} run dev`);
      const devProcess = spawn(pm, ["run", "dev"], {
        cwd: rootDir,
        stdio: "pipe",
        shell: true,
      });
      devProcess.stdout?.on("data", (d: Buffer) => process.stdout.write(d));
      devProcess.stderr?.on("data", (d: Buffer) => process.stderr.write(d));
      devProcesses.push(devProcess);
    }

    // Wait for the frontend port
    log.step("Waiting for servers…");
    await waitForPort(config.frontend.devPort, 30_000);
    log.success(`Frontend ready on port ${config.frontend.devPort}`);
  } else {
    log.success("Dev servers already running");
  }

  // --- Launch Electron -----------------------------------------------------
  log.step("Launching Electron window…");

  const electronBin = path.join(
    desktopDir,
    "node_modules",
    ".bin",
    "electron",
  );

  const electronProcess = spawn(electronBin, ["."], {
    cwd: desktopDir,
    stdio: "inherit",
  });

  // --- Cleanup on exit -----------------------------------------------------
  const cleanup = async (): Promise<void> => {
    electronProcess.kill("SIGTERM");
    for (const p of devProcesses) {
      p.kill("SIGTERM");
    }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        electronProcess.kill("SIGKILL");
        for (const p of devProcesses) {
          p.kill("SIGKILL");
        }
        resolve();
      }, 3000);

      electronProcess.on("exit", () => {
        clearTimeout(timeout);
        if (devProcesses.every((p) => p.killed)) resolve();
      });
      Promise.all(devProcesses.map((p) => new Promise<void>((r) => p.on("exit", r)))).then(() => {
        clearTimeout(timeout);
        resolve();
      });
    });

    process.exit(0);
  };

  process.on("SIGINT", () => cleanup());
  process.on("SIGTERM", () => cleanup());

  electronProcess.on("exit", () => {
    for (const p of devProcesses) {
      p.kill("SIGTERM");
    }
    process.exit(0);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function waitForPort(port: number, timeoutMs: number): Promise<void> {
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
