/**
 * shipdesk — public programmatic API.
 *
 * Use this to integrate shipdesk into your own tooling.
 *
 * @example
 * ```ts
 * import { detectProject } from "shipdesk";
 * const config = detectProject(process.cwd());
 * console.log(config.frontend.framework); // "vite"
 * ```
 *
 * @packageDocumentation
 */

export { detectProject } from "./detect/index.js";
export { initCommand } from "./commands/init.js";
export { devCommand } from "./commands/dev.js";
export { buildCommand } from "./commands/build.js";

export type {
  ShipdeskConfig,
  ProjectConfig,
  FrontendInfo,
  BackendInfo,
  MonorepoInfo,
  MonorepoType,
  PackageManager,
  FrontendFramework,
  UILibrary,
  BackendFramework,
} from "./types.js";
