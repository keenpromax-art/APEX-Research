import type { CollisionReport, ResearchDNA } from "./types";
import { compareResearchIdentities, detectCollisions, fingerprintResearchDNA } from "./similarity";

export const FLAVOUR_COLLISION_WATCH_THRESHOLD = 0.78;
export const FLAVOUR_COLLISION_THRESHOLD = 0.92;

export { compareResearchIdentities, detectCollisions, fingerprintResearchDNA };
export type { CollisionReport };

/**
 * Fail-closed flavour collision check.
 * Compares only against unrelated companies (same ticker excluded upstream).
 * Never mutates financial facts; the caller decides whether the deterministic
 * ResearchDNA-derived structure needs analyst attention.
 */
export function checkFlavourCollision(current: ResearchDNA, priors: ResearchDNA[] = []): CollisionReport {
  return detectCollisions(current, priors);
}
