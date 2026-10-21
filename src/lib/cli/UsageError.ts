/** Wrong or missing command-line input. `runCli` prints the tool's help after it. */
export class UsageError extends Error {
  override name = "UsageError";
}
