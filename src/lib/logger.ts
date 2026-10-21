type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Writes to stderr so stdout stays free for data. */
export class Logger {
  constructor(private minLevel: Level = "info") {}

  setLevel(level: Level): void {
    this.minLevel = level;
  }

  debug(message: string): void {
    this.write("debug", message);
  }
  info(message: string): void {
    this.write("info", message);
  }
  warn(message: string): void {
    this.write("warn", message);
  }
  error(message: string): void {
    this.write("error", message);
  }

  private write(level: Level, message: string): void {
    if (ORDER[level] < ORDER[this.minLevel]) return;
    const prefix = level === "info" ? "" : `[${level}] `;
    process.stderr.write(`${prefix}${message}\n`);
  }
}

export const logger = new Logger();
