import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import chalk from "chalk";
import { loadConfig } from "../config.js";
import { generateElectronMain } from "../generate/electron-main.js";
import { findAvailablePort, isPortInUse, waitForHttpEndpoint } from "../utils/net.js";
import { resolvePlatformCommand } from "../utils/exec.js";
import { log } from "../utils/logger.js";
import type { DeskpackConfig } from "../types.js";

export interface FrontendDevLaunchPlan {
  port: number;
  requiresSpawn: boolean;
  reusedPreferred: boolean;
}

/**
 * `deskpack dev`
 *
 * 1. Start the project's dev servers (if not already running).
 * 2. Wait for the frontend port to become available.
 * 3. Launch Electron pointing at the frontend dev server.
 */
export async function devCommand(rootDir: string): Promise<void> {
  log.banner();
  const config = loadConfig(rootDir);

  if (config.topology === "ssr-framework") {
    const detail =
      config.topologyEvidence.warnings.length > 0
        ? config.topologyEvidence.warnings.join(" ")
        : 'SSR/server runtime topology is not supported by deskpack dev unless it uses a supported runtime such as Next.js output: "standalone" or TanStack Start Node/Nitro output.';
    throw new Error(detail);
  }

  if (config.topology === "unsupported") {
    throw new Error(
      "Unsupported topology. Deskpack could not determine a reliable frontend/backend runtime layout.",
    );
  }

  const desktopDir = path.join(rootDir, ".deskpack", "desktop");
  if (!fs.existsSync(path.join(desktopDir, "node_modules", "electron"))) {
    log.error(
      `Electron not installed. Run ${chalk.cyan("npx deskpack init")} first.`,
    );
    process.exit(1);
  }

  log.info("Starting development mode…");
  log.blank();

  const hasBackend =
    config.topology !== "frontend-only-static" && config.backend.path !== "";
  let frontendPort = config.frontend.devPort;
  let backendPort = hasBackend ? config.backend.devPort : 0;
  const separateDevPackages =
    hasBackend &&
    config.monorepo.type === "none" &&
    config.backend.path !== config.frontend.path;
  const shouldWaitForBackend =
    hasBackend &&
    (config.topology === "frontend-static-separate" ||
      config.monorepo.type !== "none" ||
      separateDevPackages);

  const frontendAlreadyRunning = await isPortInUse(frontendPort);
  const backendAlreadyRunning = hasBackend
    ? await isPortInUse(backendPort)
    : true;

  let devProcesses: ChildProcess[] = [];

  const frontendPlan = await planFrontendDevLaunch(frontendPort, frontendAlreadyRunning);
  frontendPort = frontendPlan.port;
  if (!frontendPlan.reusedPreferred) {
    log.warn(
      `Frontend port ${config.frontend.devPort} is busy. Starting this project on ${frontendPort} instead.`,
    );
  }

  if (frontendPlan.requiresSpawn || (hasBackend && !backendAlreadyRunning)) {
    const pm = config.monorepo.packageManager;
    const pmCommand = resolvePlatformCommand(pm);

    if (config.monorepo.type !== "none") {
      const frontendPkgPath = path.join(rootDir, config.frontend.path, "package.json");
      const backendPkgPath = hasBackend
        ? path.join(rootDir, config.backend.path, "package.json")
        : "";

      if (frontendPlan.requiresSpawn) {
        const frontendPkg = JSON.parse(fs.readFileSync(frontendPkgPath, "utf-8")) as {
          name: string;
          scripts?: Record<string, string>;
        };
        const frontendScript = frontendPkg.scripts?.dev ? "dev" : "start";
        log.step("Starting frontend dev…", `${pm} run ${frontendScript}`);

        const args = buildWorkspaceFrontendCommandArgs(
          pm,
          frontendPkg.name,
          config.frontend.path,
          frontendScript,
          config.frontend.framework,
          frontendPort,
        );

        const feProcess = spawn(pmCommand, args, {
          cwd: rootDir,
          stdio: "pipe",
          shell: false,
          env: {
            ...process.env,
            PORT: String(frontendPort),
            DESKPACK_FRONTEND_PORT: String(frontendPort),
          },
        });
        feProcess.stdout?.on("data", (data: Buffer) => process.stdout.write(data));
        feProcess.stderr?.on("data", (data: Buffer) => process.stderr.write(data));
        devProcesses.push(feProcess);
      }

      if (hasBackend && !backendAlreadyRunning) {
        const backendPkg = JSON.parse(fs.readFileSync(backendPkgPath, "utf-8")) as {
          name: string;
          scripts?: Record<string, string>;
        };
        const backendScript = backendPkg.scripts?.dev ? "dev" : "start";
        log.step("Starting backend dev…", `${pm} run ${backendScript}`);

        let args: string[];
        if (pm === "pnpm") {
          args = ["--filter", backendPkg.name, "run", backendScript];
        } else if (pm === "yarn") {
          args = ["workspace", backendPkg.name, "run", backendScript];
        } else {
          args = ["--workspace", config.backend.path, "run", backendScript];
        }

        const beProcess = spawn(pmCommand, args, {
          cwd: rootDir,
          stdio: "pipe",
          shell: false,
          env: {
            ...process.env,
            PORT: String(backendPort),
            DESKPACK_BACKEND_PORT: String(backendPort),
          },
        });
        beProcess.stdout?.on("data", (data: Buffer) => process.stdout.write(data));
        beProcess.stderr?.on("data", (data: Buffer) => process.stderr.write(data));
        devProcesses.push(beProcess);
      }
    } else {
      const frontendCwd =
        config.frontend.path === "."
          ? rootDir
          : path.join(rootDir, config.frontend.path);
      const frontendPkg = JSON.parse(
        fs.readFileSync(path.join(frontendCwd, "package.json"), "utf-8"),
      ) as { scripts?: Record<string, string> };
      const frontendScript = frontendPkg.scripts?.dev ? "dev" : "start";

      if (separateDevPackages && frontendPlan.requiresSpawn) {
        log.step("Starting frontend dev…", `${pm} run ${frontendScript}`);

        const frontendProcess = spawn(
          pmCommand,
          buildProjectFrontendCommandArgs(
            pm,
            frontendScript,
            config.frontend.framework,
            frontendPort,
          ),
          {
            cwd: frontendCwd,
            stdio: "pipe",
            shell: false,
            env: {
              ...process.env,
              PORT: String(frontendPort),
              DESKPACK_FRONTEND_PORT: String(frontendPort),
              DESKPACK_BACKEND_PORT: hasBackend ? String(backendPort) : "",
            },
          },
        );
        frontendProcess.stdout?.on("data", (data: Buffer) => process.stdout.write(data));
        frontendProcess.stderr?.on("data", (data: Buffer) => process.stderr.write(data));
        devProcesses.push(frontendProcess);
      }

      if (separateDevPackages && !backendAlreadyRunning) {
        const backendCwd =
          config.backend.path === "."
            ? rootDir
            : path.join(rootDir, config.backend.path);
        const backendPkg = JSON.parse(
          fs.readFileSync(path.join(backendCwd, "package.json"), "utf-8"),
        ) as { scripts?: Record<string, string> };
        const backendScript = backendPkg.scripts?.dev ? "dev" : "start";

        log.step("Starting backend dev…", `${pm} run ${backendScript}`);

        const backendProcess = spawn(pmCommand, ["run", backendScript], {
          cwd: backendCwd,
          stdio: "pipe",
          shell: false,
          env: {
            ...process.env,
            PORT: String(backendPort),
            DESKPACK_BACKEND_PORT: String(backendPort),
          },
        });
        backendProcess.stdout?.on("data", (data: Buffer) => process.stdout.write(data));
        backendProcess.stderr?.on("data", (data: Buffer) => process.stderr.write(data));
        devProcesses.push(backendProcess);
      }

      if (!separateDevPackages && (frontendPlan.requiresSpawn || (hasBackend && !backendAlreadyRunning))) {
        const label = hasBackend ? "Starting dev servers…" : "Starting frontend dev…";
        log.step(label, `${pm} run ${frontendScript}`);

        const devProcess = spawn(
          pmCommand,
          buildProjectFrontendCommandArgs(
            pm,
            frontendScript,
            config.frontend.framework,
            frontendPort,
          ),
          {
            cwd: frontendCwd,
            stdio: "pipe",
            shell: false,
            env: {
              ...process.env,
              PORT: String(frontendPort),
              DESKPACK_FRONTEND_PORT: String(frontendPort),
              DESKPACK_BACKEND_PORT: hasBackend ? String(backendPort) : "",
            },
          },
        );
        devProcess.stdout?.on("data", (data: Buffer) => process.stdout.write(data));
        devProcess.stderr?.on("data", (data: Buffer) => process.stderr.write(data));
        devProcesses.push(devProcess);
      }
    }
  } else {
    log.success("Dev servers already running");
  }

  log.step("Waiting for frontend server…");
  await waitForHttpEndpoint(frontendPort, ["/", "/index.html", "/healthz", "/health"], 30_000);
  log.success(`Frontend ready on port ${frontendPort}`);

  if (shouldWaitForBackend) {
    log.step("Waiting for backend server…");
    await waitForHttpEndpoint(
      backendPort,
      [config.backend.healthCheckPath ?? "/", "/healthz", "/health", "/ready", "/"],
      30_000,
    );
    log.success(`Backend ready on port ${backendPort}`);
  }

  const runtimeConfig: DeskpackConfig = {
    ...config,
    frontend: { ...config.frontend, devPort: frontendPort },
    backend: { ...config.backend, devPort: backendPort || config.backend.devPort },
  };

  fs.writeFileSync(
    path.join(desktopDir, "main.cjs"),
    generateElectronMain(runtimeConfig),
  );

  log.step(
    "Using runtime ports",
    hasBackend ? `frontend ${frontendPort}, backend ${backendPort}` : `frontend ${frontendPort}`,
  );
  log.step("Launching Electron window…");

  const electronBin = path.join(desktopDir, "node_modules", ".bin", "electron");
  const electronProcess = spawn(electronBin, ["."], {
    cwd: desktopDir,
    stdio: "inherit",
  });

  const cleanup = async (): Promise<void> => {
    electronProcess.kill("SIGTERM");
    for (const processHandle of devProcesses) {
      processHandle.kill("SIGTERM");
    }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        electronProcess.kill("SIGKILL");
        for (const processHandle of devProcesses) {
          processHandle.kill("SIGKILL");
        }
        resolve();
      }, 3000);

      electronProcess.on("exit", () => {
        clearTimeout(timeout);
        if (devProcesses.every((processHandle) => processHandle.killed)) {
          resolve();
        }
      });

      Promise.all(
        devProcesses.map(
          (processHandle) =>
            new Promise<void>((resolveProcess) =>
              processHandle.on("exit", () => resolveProcess()),
            ),
        ),
      ).then(() => {
        clearTimeout(timeout);
        resolve();
      });
    });

    process.exit(0);
  };

  process.on("SIGINT", () => cleanup());
  process.on("SIGTERM", () => cleanup());

  electronProcess.on("exit", () => {
    for (const processHandle of devProcesses) {
      processHandle.kill("SIGTERM");
    }
    process.exit(0);
  });
}

export async function planFrontendDevLaunch(
  preferredPort: number,
  preferredPortInUse: boolean,
  allocatePort: (preferredPort: number) => Promise<{ port: number; reusedPreferred: boolean }> = findAvailablePort,
): Promise<FrontendDevLaunchPlan> {
  if (!preferredPortInUse) {
    return {
      port: preferredPort,
      requiresSpawn: true,
      reusedPreferred: true,
    };
  }

  const selected = await allocatePort(preferredPort);
  return {
    port: selected.port,
    requiresSpawn: true,
    reusedPreferred: false,
  };
}

export function buildProjectFrontendCommandArgs(
  packageManager: DeskpackConfig["monorepo"]["packageManager"],
  scriptName: string,
  framework: DeskpackConfig["frontend"]["framework"],
  port: number,
): string[] {
  const baseArgs = ["run", scriptName];
  return appendFrontendRuntimeArgs(baseArgs, packageManager, framework, port);
}

export function buildWorkspaceFrontendCommandArgs(
  packageManager: DeskpackConfig["monorepo"]["packageManager"],
  packageName: string,
  workspacePath: string,
  scriptName: string,
  framework: DeskpackConfig["frontend"]["framework"],
  port: number,
): string[] {
  const baseArgs =
    packageManager === "pnpm"
      ? ["--filter", packageName, "run", scriptName]
      : packageManager === "yarn"
        ? ["workspace", packageName, "run", scriptName]
        : ["--workspace", workspacePath, "run", scriptName];

  return appendFrontendRuntimeArgs(baseArgs, packageManager, framework, port);
}

function appendFrontendRuntimeArgs(
  baseArgs: string[],
  packageManager: DeskpackConfig["monorepo"]["packageManager"],
  framework: DeskpackConfig["frontend"]["framework"],
  port: number,
): string[] {
  const runtimeArgs = frontendRuntimeArgs(framework, port);
  if (runtimeArgs.length === 0) return baseArgs;
  return packageManager === "yarn"
    ? [...baseArgs, ...runtimeArgs]
    : [...baseArgs, "--", ...runtimeArgs];
}

function frontendRuntimeArgs(
  framework: DeskpackConfig["frontend"]["framework"],
  port: number,
): string[] {
  if (framework !== "vite") return [];
  return ["--host", "127.0.0.1", "--port", String(port), "--strictPort"];
}
