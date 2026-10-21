import { logger } from "../logger";
import { UsageError } from "./UsageError";

/**
 * Standard entry point for a tool: prints readable errors instead of stack traces,
 * shows help after usage errors, and exits quietly when the user presses Ctrl+C in a prompt.
 */
export function runCli(main: () => Promise<void>, help: string): void {
  main().catch((error: unknown) => {
    if (error instanceof Error && error.name === "ExitPromptError") {
      logger.info("Cancelled");
      process.exit(130);
    }
    logger.error(error instanceof Error ? error.message : String(error));
    if (error instanceof UsageError) logger.info(`\n${help}`);
    process.exit(1);
  });
}
