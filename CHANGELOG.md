# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0-beta.1] - 2026-04-17

### Added

- Hard-cut public rename to `deskpack` (CLI, package, config, and working directory).
- Frontend-only static flow support with backend bundling skipped automatically.
- Init flags for non-interactive setup: `--yes`, `--name`, `--app-id`, `--force`.
- Runtime hardening in generated Electron main process:
  - single-instance enforcement
  - path traversal protection in static server
  - broader MIME type support
  - deterministic SPA fallback to `index.html`
  - automatic free-port fallback with clear logs
  - readiness probing with configurable backend health path and fallback probe paths
- Conservative cross-platform packaging policy with explicit refusal reasons.
- Test fixtures and CLI integration coverage for supported and unsupported topologies.
- CI matrix across Node 18/20/22 plus OS smoke tests for `--skip-package`.
- OSS policy docs and issue templates.

### Changed

- Next.js support boundary is explicit:
  - static export (`output: "export"`) supported
  - SSR/server runtime rejected early
- `build --skip-package` now works without Electron installation.

### Notes

- Historical project name: `shipdesk`.
