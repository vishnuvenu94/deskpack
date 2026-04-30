/**
 * Plain-language message for CLI (no stack traces). Handles common errno shapes.
 */
export function formatUserFacingError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const direct = formatKnownErrorPatterns(error);
  if (direct) return direct;

  const errnoEx = error as NodeJS.ErrnoException & { syscall?: string; port?: number };
  if (errnoEx.code === "EADDRINUSE") {
    return formatPortInUseMessage(errnoEx.message, errnoEx.port);
  }

  if (error instanceof AggregateError) {
    for (const inner of error.errors) {
      const formatted = formatUserFacingError(inner);
      const innerMsg = inner instanceof Error ? inner.message : String(inner);
      if (formatted !== innerMsg) {
        return formatted;
      }
    }
  }

  if (error.cause instanceof Error) {
    const fromCause = formatUserFacingError(error.cause);
    if (fromCause !== error.cause.message) {
      return fromCause;
    }
  }

  return error.message;
}

function formatKnownErrorPatterns(error: Error): string | null {
  const msg = error.message;
  if (
    /\bEADDRINUSE\b/i.test(msg) ||
    /address already in use/i.test(msg) ||
    (msg.includes("Port ") && msg.includes("is in use"))
  ) {
    return formatPortInUseMessage(msg);
  }
  if (
    /\bis unavailable\b/i.test(msg) &&
    /\bport\b/i.test(msg) &&
    /\d{2,5}/.test(msg)
  ) {
    return formatPortInUseMessage(msg);
  }
  return null;
}

function parsePortFromMessage(message: string): number | undefined {
  const patterns = [
    /\[::\]:(\d{2,5})\b/,
    /127\.0\.0\.1:(\d{2,5})\b/,
    /localhost:(\d{2,5})\b/,
    /:(\d{2,5})\s*$/m,
    /\bport\s+(\d{2,5})\b/i,
  ];
  for (const re of patterns) {
    const m = message.match(re);
    if (m) {
      const n = Number(m[1]);
      if (n > 0 && n <= 65535) return n;
    }
  }
  return undefined;
}

function formatPortInUseMessage(originalMessage: string, explicitPort?: number): string {
  let port = explicitPort;
  if (port === undefined || Number.isNaN(port)) {
    port = parsePortFromMessage(originalMessage);
  }

  const intro =
    port !== undefined && port > 0
      ? `Something else is already listening on port ${port}.\n\n`
      : `Something else is already using that network port.\n\n`;

  return (
    intro +
    "Usually that is another dev server or a previous process that did not exit. Stop it " +
    "(or quit the app using it), or change the dev port in your project and in deskpack.config.json, then run again."
  );
}
