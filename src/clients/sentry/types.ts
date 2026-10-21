import type { SentryClient } from "./createSentryClient";

type ListProjectsResult = Awaited<ReturnType<SentryClient["listOrganizationProjects"]>>;
type ListEventsArgs = Parameters<SentryClient["listOrganizationEvents"]>[0];

/** Re-exported SDK types so the rest of the code does not dig into SDK internals. */
export type SentryProject = Extract<ListProjectsResult, { data: unknown }>["data"][number];
export type SentryDataset = NonNullable<ListEventsArgs>["query"]["dataset"];
