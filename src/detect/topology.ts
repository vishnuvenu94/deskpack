import fs from "node:fs";
import path from "node:path";
import type {
  Topology,
  TopologyEvidence,
  FrontendFramework,
  TanstackStartInfo,
  NextRuntimeInfo,
} from "../types.js";
import { isNextStaticExport } from "./next.js";

/** Patterns that indicate the backend serves static files. */
const STATIC_SERVING_PATTERNS = [
  // Express
  /express\s*\.\s*static\s*\(/,
  /serve-static/,
  /sendFile\s*\(\s*.*index\.html/,
  /res\s*\.\s*sendFile/,
  /res\s*\.\s*send\s*\(/,

  // Hono
  /serveStatic/,
  /staticFiles/,
  /\.get\s*\(\s*['"]\/.*['"]\s*,.*static/,
  /\.use\s*\(['"]\/\*.*static/,
  /\.get\s*\(\s*['"]\*['"]/,
  /\.get\s*\(\s*['"]\/\*['"]/,
  /c\s*\.\s*html\s*\(/,
  /c\s*\.\s*body\s*\(/,
  /readFile\s*\(\s*.*index\.html/,
  /web-dist/,
  /webDist/,

  // Fastify
  /fastify\.register\s*\(\s*['"]@fastify\/static/,
  /@fastify\/static/,
  /register\s*\(\s*require\s*\(\s*['"]@fastify\/static/,

  // Koa
  /koa-static/,
  /serve\s*\(\s*path\./,
  /koa-send/,

  // NestJS
  /ServeStaticModule/,
  /@nestjs\/serve-static/,

  // Generic
  /path\s*\.\s*join\s*\(\s*.*['"]public['"]/,
  /path\s*\.\s*join\s*\(\s*.*['"]static['"]/,
  /res\.render\s*\(\s*['"]index/,
  /catch.*all.*route.*static/,
];

/** Patterns that indicate SSR or unsupported modes. */
const SSR_PATTERNS = [
  // Next.js SSR mode (not static export)
  /next\s*\.\s*default/,
  /getServerSideProps/,
  /getStaticProps/,
  /\.page\.tsx?/,

  // SSR-specific patterns
  /renderToString/,
  /renderToNodeStream/,
  /renderToPipeableStream/,

  // NestJS SSR
  /RenderableBuilder/,
  /isSSREnabled/,
];

/**
 * Detect the deployment topology by analyzing backend source code.
 *
 * This is the most important detection pass — it determines how the
 * packaged app will be launched and what the Electron main process
 * should do.
 */
export function detectTopology(
  rootDir: string,
  backendPath: string,
  backendEntry: string,
  frontendPath: string,
  frontendFramework: FrontendFramework,
  frontendDistDir: string,
  tanstackStart?: TanstackStartInfo | null,
  nextRuntime?: NextRuntimeInfo | null,
): { topology: Topology; evidence: TopologyEvidence } {
  const evidence: TopologyEvidence = {
    staticServingPatterns: [],
    ssrPatterns: [],
    staticRoot: null,
    frontendDistFound: false,
    warnings: [],
  };

  if (
    tanstackStart?.isConfirmed &&
    tanstackStart.ineligibilityReasons.length > 0
  ) {
    evidence.warnings.push(...tanstackStart.ineligibilityReasons);
    return {
      topology: "ssr-framework",
      evidence,
    };
  }

  if (frontendFramework === "next" && nextRuntime?.mode === "unsupported") {
    evidence.warnings.push(...nextRuntime.warnings);
    return {
      topology: "ssr-framework",
      evidence,
    };
  }

  if (
    backendPath &&
    backendEntry &&
    frontendFramework === "next" &&
    nextRuntime?.mode === "standalone"
  ) {
    evidence.warnings.push(
      "Next.js standalone runtime with a separately detected backend is not supported yet. Package the backend behind Next routes or use a static frontend + API backend topology.",
    );
    return {
      topology: "unsupported",
      evidence,
    };
  }

  // If no backend, it's frontend-only
  if (!backendPath || !backendEntry) {
    if (frontendFramework === "next" && nextRuntime?.mode === "standalone") {
      return {
        topology: "next-standalone-runtime",
        evidence,
      };
    }

    if (frontendFramework === "next" && !isNextStaticExport(rootDir, frontendPath)) {
      evidence.warnings.push(
        'Next.js detected without static export or standalone runtime configuration (output: "export" or output: "standalone").',
      );
      return {
        topology: "ssr-framework",
        evidence,
      };
    }

    return {
      topology: "frontend-only-static",
      evidence,
    };
  }

  // Check if frontend dist exists at expected location
  const frontendDistPath = path.resolve(rootDir, frontendDistDir);
  evidence.frontendDistFound = fs.existsSync(frontendDistPath);

  // Scan backend source for static serving patterns
  const backendFullPath = path.resolve(rootDir, backendPath);
  scanDirectoryForPatterns(backendFullPath, STATIC_SERVING_PATTERNS, (pattern, file) => {
    evidence.staticServingPatterns.push(`${pattern.source} in ${path.relative(rootDir, file)}`);
  });

  // Scan for SSR patterns
  scanDirectoryForPatterns(backendFullPath, SSR_PATTERNS, (pattern, file) => {
    evidence.ssrPatterns.push(`${pattern.source} in ${path.relative(rootDir, file)}`);
  });

  // Determine topology based on evidence
  const topology = classifyTopology(
    rootDir,
    evidence,
    frontendFramework,
    frontendPath,
    nextRuntime ?? null,
  );

  return { topology, evidence };
}

/**
 * Classify the topology based on gathered evidence.
 */
function classifyTopology(
  rootDir: string,
  evidence: TopologyEvidence,
  frontendFramework: FrontendFramework,
  frontendPath: string,
  nextRuntime: NextRuntimeInfo | null,
): Topology {
  // If SSR patterns found, it's SSR framework (unsupported)
  if (evidence.ssrPatterns.length > 0) {
    return "ssr-framework";
  }

  // Next.js support boundary:
  // - static export (output: "export") => supported as static output
  // - standalone output => supported when it is the only server runtime
  // - other SSR / server runtime => unsupported
  if (frontendFramework === "next") {
    if (nextRuntime?.mode === "standalone") {
      return "next-standalone-runtime";
    }

    if (!isNextStaticExport(rootDir, frontendPath)) {
      evidence.warnings.push(
        'Next.js detected without static export or standalone runtime configuration (output: "export" or output: "standalone").',
      );
      return "ssr-framework";
    }
  }

  // If static serving patterns found, backend serves frontend.
  if (evidence.staticServingPatterns.length > 0) {
    return "backend-serves-frontend";
  }

  // If frontend dist exists and no static serving patterns, treat as API-only backend
  // with a separately hosted frontend.
  if (evidence.frontendDistFound) {
    return "frontend-static-separate";
  }

  // Conservative default for API-only backends where frontend is built separately.
  evidence.warnings.push(
    "No backend static-serving patterns found. Treating this as a separate static frontend + API backend topology.",
  );
  return "frontend-static-separate";
}

/**
 * Recursively scan a directory for regex patterns.
 */
function scanDirectoryForPatterns(
  dirPath: string,
  patterns: RegExp[],
  onMatch: (pattern: RegExp, file: string) => void,
): void {
  if (!fs.existsSync(dirPath)) return;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      // Skip node_modules and hidden directories
      if (
        !entry.name.startsWith(".") &&
        !["node_modules", "dist", "build", "coverage"].includes(entry.name)
      ) {
        scanDirectoryForPatterns(fullPath, patterns, onMatch);
      }
    } else if (entry.isFile()) {
      // Only scan code files
      if (/\.(ts|js|mjs|cjs|tsx|jsx)$/.test(entry.name)) {
        const content = fs.readFileSync(fullPath, "utf-8");
        for (const pattern of patterns) {
          if (pattern.test(content)) {
            onMatch(pattern, fullPath);
          }
        }
      }
    }
  }
}

/**
 * Get a human-readable description of the topology.
 */
export function topologyDescription(topology: Topology): string {
  switch (topology) {
    case "backend-serves-frontend":
      return "Backend serves both API and frontend static files";
    case "frontend-static-separate":
      return "Frontend builds to separate static dir, backend is API-only";
    case "frontend-only-static":
      return "Frontend-only static application (no backend)";
    case "next-standalone-runtime":
      return "Next.js standalone server runtime";
    case "ssr-framework":
      return "SSR framework detected (not yet supported)";
    case "unsupported":
      return "Could not determine topology — runtime verification required";
  }
}
