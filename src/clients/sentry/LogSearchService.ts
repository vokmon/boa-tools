import type { DateWindow } from "@/lib/date";
import type { SentryClient } from "./createSentryClient";

export interface LogSearchOptions {
  window: DateWindow;
  projectIds: readonly string[];
  /** Sentry search query, e.g. `message:"Position closed*"`. */
  query: string;
  /** Fields to return per log. */
  fields: readonly string[];
  environment?: string;
  /** Rows per request, max 100. */
  pageSize?: number;
}

export type LogRow = Record<string, unknown>;

const PAGE_SIZE = 100;

/** Pages through raw log rows from the org events endpoint (logs dataset), newest first. */
export class LogSearchService {
  constructor(
    private readonly sentry: Pick<SentryClient, "listOrganizationEvents">,
    private readonly org: string,
  ) {}

  async *iterateLogs(options: LogSearchOptions): AsyncGenerator<LogRow> {
    const fields = [...new Set([...options.fields, "timestamp"])];
    let cursor: string | undefined;
    do {
      const { data, response } = await this.sentry.listOrganizationEvents({
        path: { organization_id_or_slug: this.org },
        query: {
          dataset: "logs",
          field: fields,
          query: options.query,
          project: [...options.projectIds],
          environment: options.environment ? [options.environment] : undefined,
          start: options.window.start.toISOString(),
          end: options.window.end.toISOString(),
          sort: "-timestamp",
          per_page: options.pageSize ?? PAGE_SIZE,
          cursor,
        },
        throwOnError: true,
      });
      yield* data.data;
      cursor = nextCursor(response.headers.get("link"));
    } while (cursor);
  }

  /** The most recent matching log row, or null. */
  async findLatest(options: Omit<LogSearchOptions, "pageSize">): Promise<LogRow | null> {
    for await (const row of this.iterateLogs({ ...options, pageSize: 1 })) return row;
    return null;
  }
}

/** Sentry paginates with a Link header: `<url>; rel="next"; results="true"; cursor="..."`. */
export function nextCursor(link: string | null): string | undefined {
  if (!link) return undefined;
  for (const part of link.split(",")) {
    if (/rel="next"/.test(part) && /results="true"/.test(part)) return /cursor="([^"]+)"/.exec(part)?.[1];
  }
  return undefined;
}
