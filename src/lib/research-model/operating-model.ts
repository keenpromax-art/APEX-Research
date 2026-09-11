/**
 * APEX RESEARCH — Hard Company Operating-Model Layer
 * --------------------------------------------------
 * A ResearchOperatingModel is built EXACTLY ONCE per report, from the
 * CompanyOntology plus the explicit sector-driver pack, and then handed to
 * every report section (LLM agents, deterministic engine, writer-checker,
 * QA). No section may independently classify the company: every consumer
 * receives the same frozen instance.
 *
 * CompanyOntology remains the classification authority; this module is the
 * distribution authority (single instance, frozen, digestible).
 */
import type { CompanyProfile } from "@/types/report";
import type { SectorId } from "../sectors/types";
import type { GICSSector, FinancialArchetype, ArchetypeProfile } from "../company-archetype";
import { classifyArchetype } from "../company-archetype";
import { buildCompanyOntology, type CompanyOntology } from "../company-ontology";
import { getSectorDriverPack, isKnownSectorPack, type SectorDriverPack } from "./sector-drivers";

export const RESEARCH_MODEL_VERSION = "research-model-v1-2026-09";

export interface ResearchOperatingModel {
  /** Stable identity for log/QA attribution (ticker + ontology version). */
  modelId: string;
  modelVersion: string;
  companyName: string;
  ticker: string;
  // ── Authoritative operating identity (from CompanyOntology, never re-derived) ──
  sector: SectorId;
  sectorName: string;
  subSector: string;
  segments: string[];
  operatingArchetype: GICSSector;
  financialArchetype: FinancialArchetype;
  // ── Explicit drivers (pack wins; generic fallback eliminated for known sectors) ──
  revenueDrivers: string[];
  costDrivers: string[];
  capexDrivers: string[];
  nwcDrivers: string[];
  unitEconomics: string;
  // ── Vocabulary controls ──
  kpis: string[];
  risks: string[];
  catalysts: string[];
  valuationMethods: CompanyOntology["valuationMethods"];
  competitors: string[];
  requiredConcepts: string[];
  forbiddenConcepts: string[];
  standardMarginMetric: CompanyOntology["standardMarginMetric"];
  isFinancialInstitution: boolean;
  /** False only for `general` — generic drivers survive there and nowhere else. */
  isKnownSector: boolean;
}

function dedupe(lower: boolean, ...lists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list ?? []) {
      const item = (raw ?? "").trim();
      if (!item) continue;
      const key = lower ? item.toLowerCase() : item;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

export interface BuildModelInput {
  profile: CompanyProfile;
  /** Pass through when the caller already classified (avoids double work, never double truth). */
  archetypeProfile?: ArchetypeProfile;
}

/**
 * THE single classification point for narrative work. Builds the ontology
 * once, overlays the explicit driver pack, merges vocabulary controls, and
 * deep-freezes the result. Every section must receive THIS instance.
 */
export function buildResearchOperatingModel(input: BuildModelInput): ResearchOperatingModel {
  const { profile } = input;
  const arch = input.archetypeProfile ?? classifyArchetype(profile, { currentPrice: 0 } as never, [] as never);
  const onto = buildCompanyOntology(profile, arch);
  const pack: SectorDriverPack = getSectorDriverPack(onto.sectorId);
  const known = isKnownSectorPack(onto.sectorId);

  // Drivers: pack wins for known sectors (generic fallback eliminated).
  // The ontology's own driverSpec (sector-profile native) still takes
  // precedence where present — it is the most specific authority.
  const revenueDrivers = known && onto.revenueDrivers.length > 0 && isGenericDriverSet(onto.revenueDrivers)
    ? [...pack.revenueDrivers]
    : onto.revenueDrivers;
  const costDrivers = known && isGenericDriverSet(onto.costDrivers)
    ? [...pack.costDrivers]
    : onto.costDrivers;
  const capexDrivers = known && isGenericDriverSet(onto.capexDrivers)
    ? [...pack.capexDrivers]
    : onto.capexDrivers;

  const model: ResearchOperatingModel = {
    modelId: `${profile.ticker || "UNKNOWN"}@${onto.ontologyVersion}`,
    modelVersion: RESEARCH_MODEL_VERSION,
    companyName: profile.name || profile.ticker || "Unknown",
    ticker: profile.ticker || "UNKNOWN",
    sector: onto.sectorId,
    sectorName: onto.sectorName,
    subSector: onto.subSector,
    segments: onto.segments.length === 1 && onto.segments[0] === "consolidated operations" && pack.segments.length > 0
      ? [...pack.segments]
      : [...onto.segments],
    operatingArchetype: onto.operatingArchetype,
    financialArchetype: onto.financialArchetype,
    revenueDrivers,
    costDrivers,
    capexDrivers,
    nwcDrivers: [...pack.nwcDrivers],
    unitEconomics: pack.unitEconomics,
    kpis: dedupe(true, onto.kpis, pack.kpis),
    risks: dedupe(true, onto.risks, pack.risks),
    catalysts: dedupe(true, onto.catalysts, pack.catalysts),
    valuationMethods: [...onto.valuationMethods],
    competitors: [...onto.competitors],
    requiredConcepts: dedupe(true, onto.requiredConcepts, pack.requiredConcepts),
    forbiddenConcepts: dedupe(true, onto.forbiddenConcepts, pack.forbiddenConcepts),
    standardMarginMetric: onto.standardMarginMetric,
    isFinancialInstitution: onto.isFinancialInstitution,
    isKnownSector: known,
  };
  return deepFreezeModel(model);
}

/** The legacy generic driver sets that packs replace wherever a sector is known. */
const GENERIC_DRIVER_SETS: string[][] = [
  ["volume", "realization / pricing", "mix"],
  ["input costs", "operating leverage"],
  ["maintenance capex", "growth capex"],
];

function isGenericDriverSet(drivers: string[]): boolean {
  const norm = drivers.map((d) => d.trim().toLowerCase());
  return GENERIC_DRIVER_SETS.some((g) => g.length === norm.length && g.every((x, i) => norm[i] === x));
}

function deepFreezeModel<T>(obj: T): T {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    for (const v of Object.values(obj as Record<string, unknown>)) deepFreezeModel(v as object);
    Object.freeze(obj);
  }
  return obj;
}

/**
 * Compact model digest for prompt injection and QA attribution. Sections
 * receive the digest PLUS the full instance — never a re-classification.
 */
export function getOperatingModelDigest(model: ResearchOperatingModel): string {
  return [
    `Operating model ${model.modelId} (${model.modelVersion}): ${model.sectorName} [${model.sector}] / ${model.subSector}; archetypes ${model.operatingArchetype}/${model.financialArchetype}.`,
    `Unit economics: ${model.unitEconomics}`,
    `Revenue drivers: ${model.revenueDrivers.join("; ")}. Cost drivers: ${model.costDrivers.join("; ")}. Capex: ${model.capexDrivers.join("; ")}. NWC: ${model.nwcDrivers.join("; ")}.`,
    `KPIs (use ONLY these): ${model.kpis.slice(0, 10).join("; ")}.`,
    `REQUIRED concepts (evidence ≥2): ${model.requiredConcepts.slice(0, 8).join(", ")}.`,
    `FORBIDDEN concepts (never mention): ${model.forbiddenConcepts.join(", ") || "none"}.`,
    `Valuation lens: ${model.valuationMethods.join(", ")}; margin metric: ${model.standardMarginMetric}.`,
  ].join("\n");
}
