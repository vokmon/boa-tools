import type { SentryClient } from "./createSentryClient";
import type { SentryProject } from "./types";

export class ProjectsService {
  constructor(
    private readonly sentry: Pick<SentryClient, "listOrganizationProjects">,
    private readonly org: string,
  ) {}

  async listProjects(): Promise<SentryProject[]> {
    const { data } = await this.sentry.listOrganizationProjects({
      path: { organization_id_or_slug: this.org },
      throwOnError: true,
    });
    return [...data].sort((a, b) => a.slug.localeCompare(b.slug));
  }
}
