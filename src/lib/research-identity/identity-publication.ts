import type { ResearchDNA } from "./types";

export interface IdentityPublicationState {
  canPublish: boolean;
  publishAllowed: boolean;
  label: string;
  reasons: string[];
}

export function identityPublicationFromQa(input: { identity: ResearchDNA | null; qaDecision: string | null; canPublish: boolean }): IdentityPublicationState {
  const reasons: string[] = [];
  if (!input.identity) reasons.push("Research identity is unavailable");
  const collision = input.identity?.collision;
  if (collision?.status === "template-collision") reasons.push(`Identity collision blocks publication: ${collision.reasons.join("; ")}`);
  if (input.qaDecision === "BLOCK") reasons.push("Canonical QA decision is BLOCK");
  if (input.qaDecision === "REVIEW") reasons.push("Canonical QA decision is REVIEW");
  if (!input.canPublish) reasons.push("Canonical quality gate does not allow publication");
  if (reasons.length > 0) return { canPublish: false, publishAllowed: false, label: "Diagnostic preview (non-publishable)", reasons };
  if (collision?.status === "watch") return { canPublish: true, publishAllowed: true, label: "Qualified PDF with disclosed qualifications", reasons: [`Identity watch: ${collision.reasons.join("; ")}`] };
  if (input.qaDecision === "QUALIFIED") return { canPublish: true, publishAllowed: true, label: "Qualified PDF with disclosed qualifications", reasons: [] };
  return { canPublish: true, publishAllowed: true, label: "PDF", reasons: [] };
}

export function collisionStatusOf(identity: ResearchDNA | null): string {
  return identity?.collision.status ?? "clear";
}
