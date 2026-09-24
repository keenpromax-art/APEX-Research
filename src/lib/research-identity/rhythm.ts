import type { MaterialityTopicId } from "./proposal";
import { SECTION_RHYTHM } from "./registry";

/**
 * Deterministic information rhythm per analytical topic.
 * The PDF stays a narrative → evidence → implication cadence;
 * rhythm varies by section type, never by randomness.
 */
export function rhythmForTopic(topicId: MaterialityTopicId): string[] {
  return [...(SECTION_RHYTHM[topicId] ?? ["narrative", "evidence-table", "implication"])];
}

export function rhythmForDepth(topicId: MaterialityTopicId, depth: number): string[] {
  const base = rhythmForTopic(topicId);
  if (depth <= 0) return [];
  if (depth === 1) return base.slice(0, 2);
  if (depth >= 5) return [...base, "scenario", "conclusion"];
  return base;
}
