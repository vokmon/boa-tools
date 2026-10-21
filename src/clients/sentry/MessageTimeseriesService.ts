import type { DateWindow } from "@/lib/date";
import type { SentryClient } from "./createSentryClient";
import type { SentryDataset } from "./types";

export interface MessageTimeseriesOptions {
  window: DateWindow;
  projectIds: readonly string[];
  datasets: readonly SentryDataset[];
  environment?: string;
  /** Bucket size. One hour keeps buckets aligned with local midnight in whole-hour timezones. */
  intervalSeconds?: number;
}

export interface TimeBucket {
  start: Date;
  count: number;
}

import { assertSafeSearchText } from "@/domain/appLogs";

/** Counts log/event messages containing a text over time, through the org events timeseries endpoint. */
export class MessageTimeseriesService {
  constructor(
    private readonly sentry: Pick<SentryClient, "listOrganizationEventsTimeseries">,
    private readonly org: string,
  ) {}

  /** Buckets with non-zero counts, summed across all datasets, oldest first. */
  async countMessagesContaining(text: string, options: MessageTimeseriesOptions): Promise<TimeBucket[]> {
    assertSafeSearchText(text);
    const totals = new Map<number, number>();
    for (const dataset of options.datasets) {
      for (const bucket of await this.timeseries(dataset, `message:*${text}*`, options)) {
        totals.set(bucket.timestamp, (totals.get(bucket.timestamp) ?? 0) + bucket.value);
      }
    }
    return [...totals]
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => a - b)
      .map(([timestamp, count]) => ({ start: new Date(timestamp), count }));
  }

  private async timeseries(dataset: SentryDataset, query: string, options: MessageTimeseriesOptions) {
    const { data } = await this.sentry.listOrganizationEventsTimeseries({
      path: { organization_id_or_slug: this.org },
      query: {
        dataset,
        yAxis: "count()",
        query,
        interval: options.intervalSeconds ?? 3600,
        project: [...options.projectIds],
        environment: options.environment ? [options.environment] : undefined,
        start: options.window.start.toISOString(),
        end: options.window.end.toISOString(),
      },
      throwOnError: true,
    });
    return data.timeSeries.flatMap((series) => series.values);
  }
}
