# Support

`deskpack` is in beta. Support is best-effort and focused on reproducible issues within the documented support matrix.

## Before Opening an Issue

- Confirm the app shape is within the beta scope in `README.md`
- Run `npm run check:release` if you are contributing a fix
- Collect the exact `deskpack` version, Node.js version, OS, target platform, and project topology

## Good Bug Reports Include

- A minimal reproduction repository or stripped-down fixture
- The contents of `deskpack.config.json` if init completed
- The exact command that failed
- Full terminal output and stack trace

## What Maintainers May Decline

- Requests for unsupported SSR or runtime-server topologies, including Next.js apps without standalone output or TanStack Start apps without Node/Nitro output
- Environment-specific issues without a reproduction
- Packaging expectations that depend on Docker being shipped as part of the desktop runtime
