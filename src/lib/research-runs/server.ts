import { getCloudflareContext } from "@opennextjs/cloudflare";
import { D1ResearchRunStore, isD1ResearchRunDatabase } from "./d1-store";
import type { ResearchRunStore } from "./store";

export const RESEARCH_RUN_D1_BINDING = "RESEARCH_RUN_DB" as const;

export async function getDurableResearchRunStore(): Promise<ResearchRunStore | null> {
  try {
    const context = await getCloudflareContext({ async: true });
    const database = (context.env as Readonly<Record<string, unknown>>)[RESEARCH_RUN_D1_BINDING];
    if (!isD1ResearchRunDatabase(database)) return null;
    return new D1ResearchRunStore(database);
  } catch {
    return null;
  }
}
