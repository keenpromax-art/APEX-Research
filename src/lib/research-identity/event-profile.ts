import type { EventProfile, IdentityEventItem, ResearchIdentitySource } from "./types";
import { indexResearchReferences, makeEvidenceReferences } from "./evidence-profile";

type Index = ReturnType<typeof indexResearchReferences>;

function factRefs(text: string, index: Index) {
  const matches = text.match(/\[[A-Za-z]-.+?\]/g) ?? [];
  return makeEvidenceReferences([...new Set(matches)].slice(0, 6).map((id) => ({ id, kind: "ai-fact" as const })), index, 6);
}

function toItems(
  rows: Array<{ catalyst?: string; risk?: string; mechanism: string; timeframe?: string; direction?: string; quantitative: boolean }>,
  kind: "catalyst" | "risk",
  index: Index
): IdentityEventItem[] {
  return rows.slice(0, 12).map((row, position) => {
    const title = row.catalyst || row.risk || "Untitled event";
    const references = factRefs(`${title} ${row.mechanism}`, index);
    let direction: IdentityEventItem["direction"] = "unknown";
    if (row.direction === "positive" || row.direction === "negative" || row.direction === "mixed") direction = row.direction;
    return {
      id: `${kind}-${position + 1}`,
      title: title.replace(/\s+/g, " ").trim().slice(0, 220),
      mechanism: row.mechanism.replace(/\s+/g, " ").trim().slice(0, 500),
      horizon: row.timeframe?.replace(/\s+/g, " ").trim().slice(0, 120) ?? null,
      direction,
      quantitative: Boolean(row.quantitative),
      references,
    };
  });
}

export function buildEventProfile(source: ResearchIdentitySource, index: Index): EventProfile {
  const report = source.researchReport;
  const catalysts = toItems(
    (report?.catalysts ?? []).map((c) => ({
      catalyst: c.catalyst,
      mechanism: c.mechanism,
      timeframe: c.timeframe,
      direction: c.direction,
      quantitative: c.quantitative,
    })),
    "catalyst",
    index
  );
  const risks = toItems(
    (report?.risks ?? []).map((r) => ({
      risk: r.risk,
      mechanism: `${r.mechanism} ${r.financialConsequence} ${r.valuationConsequence}`.trim(),
      quantitative: r.financialConsequence.length > 0,
    })),
    "risk",
    index
  );
  const eventCategories = [...source.researchCase.catalysts.eventCategories];
  const references = [
    ...catalysts.flatMap((c) => c.references),
    ...risks.flatMap((r) => r.references),
  ].filter((r) => r.status === "supported").slice(0, 12);
  const supportedItems = [...catalysts, ...risks].filter((item) => item.references.some((r) => r.status === "supported")).length;
  const coverageScore = catalysts.length + risks.length > 0 ? supportedItems / (catalysts.length + risks.length) : 0;
  return {
    status: catalysts.length + risks.length === 0 ? "unavailable" : supportedItems > 0 ? "available" : "insufficient",
    catalysts,
    risks,
    eventCategories,
    coverageScore: Math.round(coverageScore * 1000) / 1000,
    references,
  };
}
