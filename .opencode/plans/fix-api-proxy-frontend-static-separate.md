# Fix: API proxy for `frontend-static-separate` topology in desktop builds

## Problem

When building a desktop app with `frontend-static-separate` topology, the frontend makes
relative API calls (e.g., `fetch("/api/notes")`). In dev mode, Vite's proxy config forwards
these to the backend. But in the packaged Electron app, the static file server has no proxy,
so `/api/*` requests fall through to the SPA catch-all (returning `index.html`), which causes:

```
Unexpected token '<', "<!DOCTYPE "... is not valid JSON
```

## Root Cause

In `src/generate/electron-main.ts`, the `startStaticServer` function only serves static files.
When the browser requests `/api/notes`, the static server finds no matching file, has no file
extension, and falls through to serving `index.html` (SPA fallback). The frontend receives HTML
instead of JSON and fails to parse it.

## Fix

### 1. Add `apiPrefixes` to `DeskpackConfig.backend` type (`src/types.ts`)

Add `apiPrefixes?: string[]` to the backend config interface. This allows users to configure
which URL prefixes should be proxied to the backend (default: `["/api"]`).

### 2. Add Vite proxy prefix detection (`src/detect/frontend.ts`)

Add a `detectApiPrefixes` function that parses vite config files for proxy key patterns.
Example regex: `/["']\s*(\/[a-zA-Z][a-zA-Z0-9_-]*)\s*["']\s*:\s*\{/` inside a `proxy` block.
When proxy config is found, extract the path keys as apiPrefixes. Fall back to `["/api"]`.

### 3. Propagate apiPrefixes through config loading (`src/config.ts`)

After loading the config, default `apiPrefixes` to `["/api"]` if not set. Also accept it from
the config JSON if the user has specified custom prefixes.

### 4. Add proxy logic to `electron-main.ts` generator (`src/generate/electron-main.ts`)

This is the core fix. Changes to the generated `main.cjs`:

**a. Add `API_PROXY_PREFIXES` constant:**
```javascript
const API_PROXY_PREFIXES = ["/api"];  // or whatever prefixes are detected
```

**b. Add `proxyApiRequest` function:**
```javascript
function proxyApiRequest(request, response, backendPort) {
  const options = {
    hostname: "127.0.0.1",
    port: backendPort,
    path: request.url,
    method: request.method,
    headers: { ...request.headers, "X-Forwarded-For": "127.0.0.1" },
  };

  const proxyRequest = http.request(options, (proxyResponse) => {
    if (!proxyResponse.statusCode) {
      response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Bad Gateway");
      return;
    }
    response.writeHead(proxyResponse.statusCode, proxyResponse.headers);
    proxyResponse.pipe(response);
  });

  proxyRequest.on("error", (error) => {
    if (!response.headersSent) {
      response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Proxy error: " + error.message);
    }
  });

  request.pipe(proxyRequest);
}
```

**c. Modify `startStaticServer` to accept `backendPort` and proxy API requests:**
```javascript
async function startStaticServer(preferredPort, backendPort) {
  // ... existing code ...

  staticServer = http.createServer((request, response) => {
    if (backendPort > 0) {
      let pathname = "/";
      try {
        pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
      } catch {}

      if (API_PROXY_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
        proxyApiRequest(request, response, backendPort);
        return;
      }
    }
    serveStaticRequest(staticRoot, request, response);
  });

  // ... rest of existing code ...
}
```

**d. Reverse startup order in `resolveLoadUrl` for `frontend-static-separate`:**
```javascript
if (TOPOLOGY === "frontend-static-separate") {
  if (isDev) { /* ... existing dev code ... */ }

  const backendPort = await startBundledBackend(PREFERRED_API_PORT);
  const frontendPort = await startStaticServer(PREFERRED_FRONTEND_PORT, backendPort);
  return "http://127.0.0.1:" + frontendPort;
}
```

### 5. Update the generated config in `init` command

When `deskpack init` generates `deskpack.config.json`, include `apiPrefixes` in the backend
section so users can customize it.

### 6. Update the test (`test/unit-config-runtime-platform.test.mjs`)

Add assertions to verify the generated electron main includes proxy logic when the topology
is `frontend-static-separate`.

## Files to Modify

1. `src/types.ts` — add `apiPrefixes?: string[]` to backend config
2. `src/detect/frontend.ts` — add `detectApiPrefixes()` function
3. `src/config.ts` — default apiPrefixes if not set
4. `src/generate/electron-main.ts` — add proxy logic, modify startStaticServer, reverse startup order
5. `src/commands/init.ts` (if it exists) — include apiPrefixes in generated config
6. `test/unit-config-runtime-platform.test.mjs` — add test assertions

## Verification

1. Run existing unit tests: `npm test`
2. Rebuild the tool: `npm run build`
3. Regenerate the desktop wrapper in the test project and rebuild the desktop app
4. Verify `/api` requests are proxied correctly and the JSON parsing error is resolved