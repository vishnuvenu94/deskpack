import type { DeskpackConfig } from "../types.js";

export function hasWindowsNativeRuntimePrerequisite(config: DeskpackConfig): boolean {
  return config.backend.nativeDeps.length > 0 || usesManagedDrizzleSqlite(config);
}

export function needsLibsqlRuntimeProbe(config: DeskpackConfig): boolean {
  return (
    config.backend.nativeDeps.some((dep) => dep === "@libsql/client" || dep === "libsql") ||
    usesManagedDrizzleSqlite(config)
  );
}

function usesManagedDrizzleSqlite(config: DeskpackConfig): boolean {
  return config.database?.provider === "sqlite" && config.database.driver === "drizzle";
}
