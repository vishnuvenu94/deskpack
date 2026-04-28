/** Monorepo tool type. */
export type MonorepoType = "pnpm" | "yarn" | "npm" | "lerna" | "nx" | "turbo" | "none";

/** Package manager used in the project. */
export type PackageManager = "pnpm" | "yarn" | "npm";

/** Frontend build tool / meta-framework. */
export type FrontendFramework = "vite" | "next" | "cra" | "angular" | "webpack" | "parcel" | "unknown";

/** UI library / framework. */
export type UILibrary = "react" | "vue" | "svelte" | "angular" | "solid" | "unknown";

/** Backend server framework. */
export type BackendFramework = "express" | "hono" | "fastify" | "koa" | "nestjs" | "http" | "unknown";

/** Package target platform. */
export type BuildPlatform = "darwin" | "win32" | "linux";

/**
 * Deployment topology — the critical classification that determines
 * how the app is packaged and run in production.
 */
export type Topology =
  /** Backend serves both API and frontend static files (express.static, Hono static, etc.) */
  | "backend-serves-frontend"
  /** Frontend builds to a separate static dir, backend is API-only */
  | "frontend-static-separate"
  /** Frontend-only static app (no backend detected) */
  | "frontend-only-static"
  /** Next.js standalone server runtime */
  | "next-standalone-runtime"
  /** TanStack Start Node/Nitro server runtime */
  | "tanstack-start-runtime"
  /** SSR framework without a supported runtime output */
  | "ssr-framework"
  /** Detection could not determine a reliable topology */
  | "unsupported";

/** Evidence that led to topology classification. */
export interface TopologyEvidence {
  /** Patterns found in backend that indicate static file serving */
  staticServingPatterns: string[];
  /** Patterns found that indicate SSR (Next.js SSR, etc.) */
  ssrPatterns: string[];
  /** Whether a static root directory was identified */
  staticRoot: string | null;
  /** Whether frontend dist was found at expected location */
  frontendDistFound: boolean;
  /** Any warnings about the detection */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Detection results (internal)
// ---------------------------------------------------------------------------

export interface MonorepoInfo {
  type: MonorepoType;
  packageManager: PackageManager;
  workspaces: string[];
}

/** TanStack Start Node/Nitro runtime output analysis. */
export interface TanstackStartRuntimeInfo {
  mode: "node";
  outputDir: string;
  serverFile: string;
  publicDir: string;
  warnings: string[];
}

/** TanStack Start analysis for static or Node/Nitro runtime packaging. */
export interface TanstackStartInfo {
  /** Start dependency present and `tanstackStart`-style plugin call found in Vite config. */
  isConfirmed: boolean;
  mode: "static" | "node-runtime" | "unsupported";
  spaEnabled: boolean;
  prerenderEnabled: boolean;
  runtime?: TanstackStartRuntimeInfo;
  /** Non-empty when this Start app cannot be packaged by deskpack. */
  ineligibilityReasons: string[];
}

/** Next.js runtime output analysis for static export or standalone server packaging. */
export interface NextRuntimeInfo {
  mode: "static-export" | "standalone" | "unsupported";
  standaloneDir: string;
  serverFile: string;
  staticDir: string;
  publicDir: string;
  warnings: string[];
}

export interface FrontendInfo {
  framework: FrontendFramework;
  uiLibrary: UILibrary;
  path: string;
  buildCommand: string;
  devCommand: string;
  devPort: number;
  distDir: string;
  /** Set when `@tanstack/react-start` / `@tanstack/solid-start` + Vite plugin usage is confirmed. */
  tanstackStart?: TanstackStartInfo;
  /** Set for Next.js projects to describe supported runtime output mode. */
  nextRuntime?: NextRuntimeInfo;
}

export interface BackendInfo {
  framework: BackendFramework;
  path: string;
  entry: string;
  devCommand: string;
  devPort: number;
  nativeDeps: string[];
  /** Commands to run for backend dev (may differ from devCommand for monorepos) */
  startCommand?: string;
  /** Working directory for backend commands */
  cwd?: string;
  /** Preferred HTTP path for readiness probes */
  healthCheckPath?: string;
  /** URL prefixes that should be proxied to the backend in desktop mode (e.g. ["/api"]) */
  apiPrefixes?: string[];
  /**
   * When set, the desktop proxy strips this prefix before forwarding to the
   * backend. Format is a simple string like "/api" (the leading portion to
   * remove). This mirrors Vite dev-proxy `rewrite` behaviour so the same
   * backend routes work in both dev and the packaged desktop app.
   */
  proxyRewrite?: string;
}

/** Full detection result returned by `detectProject`. */
export interface ProjectConfig {
  name: string;
  appId: string;
  version: string;
  rootDir: string;
  monorepo: MonorepoInfo;
  frontend: FrontendInfo;
  backend: BackendInfo;
  topology: Topology;
  topologyEvidence: TopologyEvidence;
  electron: {
    window: { width: number; height: number };
  };
}

// ---------------------------------------------------------------------------
// Persisted config (deskpack.config.json)
// ---------------------------------------------------------------------------

export interface DeskpackConfig {
  name: string;
  appId: string;
  version: string;
  frontend: {
    path: string;
    framework: FrontendFramework;
    buildCommand: string;
    distDir: string;
    devPort: number;
    tanstackStart?: TanstackStartInfo;
    nextRuntime?: NextRuntimeInfo;
  };
backend: {
    framework: BackendFramework;
    path: string;
    entry: string;
    devPort: number;
    nativeDeps: string[];
    startCommand?: string;
    cwd?: string;
    healthCheckPath?: string;
    apiPrefixes?: string[];
    proxyRewrite?: string;
  };
  monorepo: {
    type: MonorepoType;
    packageManager: PackageManager;
  };
  topology: Topology;
  topologyEvidence: TopologyEvidence;
  electron: {
    window: { width: number; height: number };
  };
}
