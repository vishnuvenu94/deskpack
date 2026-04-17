import { spawnSync } from "node:child_process";
import type { BuildPlatform, DeskpackConfig } from "../types.js";

export interface PlatformBuildDecision {
  allowed: boolean;
  hostPlatform: BuildPlatform;
  targetPlatform: BuildPlatform;
  reasons: string[];
  warnings: string[];
}

const PLATFORM_LABELS: Record<BuildPlatform, string> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

/**
 * Decide whether packaging for a target OS is straightforward and reliable from
 * this host. The policy is intentionally conservative; when cross-build support
 * depends on target-native binaries or fragile toolchains, we stop early with a
 * concrete explanation instead of letting electron-builder fail later.
 */
export function inspectPlatformBuild(
  config: DeskpackConfig,
  targetPlatform: BuildPlatform,
  hostPlatform = normalizeNodePlatform(process.platform),
): PlatformBuildDecision {
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (hostPlatform === targetPlatform) {
    return {
      allowed: true,
      hostPlatform,
      targetPlatform,
      reasons,
      warnings,
    };
  }

  const nativeDeps = config.backend.nativeDeps ?? [];
  if (nativeDeps.length > 0) {
    reasons.push(
      `This project externalizes native/runtime dependencies (${nativeDeps.join(", ")}). ` +
        `Those dependencies must be installed for ${PLATFORM_LABELS[targetPlatform]}, ` +
        `not ${PLATFORM_LABELS[hostPlatform]}.`,
    );
  }

  if (targetPlatform === "darwin") {
    reasons.push(
      "macOS apps should be packaged on macOS because the build uses Apple-specific packaging/signing tooling.",
    );
  }

  if (targetPlatform === "linux") {
    reasons.push(
      "Linux installers should be packaged on Linux for reliable AppImage/deb tooling and target-compatible native assets.",
    );
  }

  if (targetPlatform === "win32") {
    if (!hasCommand("wine") && !hasCommand("wine64")) {
      reasons.push(
        "Windows cross-builds require Wine to run the Windows packaging toolchain, but Wine was not found on PATH.",
      );
    }

    if (reasons.length === 0) {
      warnings.push(
        "Cross-building Windows from this OS is allowed because no native dependencies were detected and Wine is available.",
      );
    }
  }

  return {
    allowed: reasons.length === 0,
    hostPlatform,
    targetPlatform,
    reasons,
    warnings,
  };
}

export function normalizeBuildPlatform(value: string | undefined): BuildPlatform {
  const normalized = (value ?? "current").trim().toLowerCase();

  if (normalized === "current") return normalizeNodePlatform(process.platform);
  if (["mac", "macos", "darwin"].includes(normalized)) return "darwin";
  if (["win", "windows", "win32"].includes(normalized)) return "win32";
  if (normalized === "linux") return "linux";

  throw new Error(
    `Unknown platform "${value}". Use one of: current, mac, windows, linux.`,
  );
}

export function platformLabel(platform: BuildPlatform): string {
  return PLATFORM_LABELS[platform];
}

function normalizeNodePlatform(platform: NodeJS.Platform): BuildPlatform {
  if (platform === "darwin" || platform === "win32" || platform === "linux") {
    return platform;
  }

  throw new Error(`Unsupported host platform: ${platform}`);
}

function hasCommand(command: string): boolean {
  const result = spawnSync(command, ["--version"], {
    stdio: "ignore",
    shell: false,
  });

  return result.status === 0;
}
