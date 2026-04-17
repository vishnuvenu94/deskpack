import chalk from "chalk";
import ora, { type Ora } from "ora";

const PREFIX = chalk.hex("#7C3AED").bold("shipdesk");

/**
 * Pretty logger with coloured prefixes, spinners, and structured output.
 */
export const log = {
  info(msg: string): void {
    console.log(`${PREFIX} ${msg}`);
  },

  success(msg: string): void {
    console.log(`${PREFIX} ${chalk.green("✓")} ${msg}`);
  },

  warn(msg: string): void {
    console.log(`${PREFIX} ${chalk.yellow("⚠")} ${msg}`);
  },

  error(msg: string): void {
    console.error(`${PREFIX} ${chalk.red("✗")} ${msg}`);
  },

  dim(msg: string): void {
    console.log(`${PREFIX} ${chalk.dim(msg)}`);
  },

  blank(): void {
    console.log();
  },

  /** Log an action step with an optional detail string. */
  step(label: string, detail?: string): void {
    const detailStr = detail ? chalk.dim(` (${detail})`) : "";
    console.log(`${PREFIX} ${chalk.cyan("→")} ${label}${detailStr}`);
  },

  /** Log a key-value table. */
  table(rows: Record<string, string>): void {
    const maxKey = Math.max(...Object.keys(rows).map((k) => k.length));
    for (const [key, value] of Object.entries(rows)) {
      console.log(`${PREFIX}   ${chalk.dim(key.padEnd(maxKey))}  ${value}`);
    }
  },

  /** Start an ora spinner and return the instance. */
  spinner(text: string): Ora {
    return ora({ text, prefixText: PREFIX }).start();
  },

  /** Print the shipdesk banner. */
  banner(): void {
    console.log();
    console.log(
      chalk.hex("#7C3AED").bold("  ┌──────────────────────────────────────┐"),
    );
    console.log(
      chalk.hex("#7C3AED").bold("  │") +
        chalk.white.bold("  ⚡ shipdesk ") +
        chalk.dim("v0.1.0") +
        "               " +
        chalk.hex("#7C3AED").bold("│"),
    );
    console.log(
      chalk.hex("#7C3AED").bold("  │") +
        chalk.dim("  Full-stack JS → Desktop App       ") +
        chalk.hex("#7C3AED").bold("│"),
    );
    console.log(
      chalk.hex("#7C3AED").bold("  └──────────────────────────────────────┘"),
    );
    console.log();
  },
};
