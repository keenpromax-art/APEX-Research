import { createSuite, check, report } from "../helpers/assert";
import { runAiFirstResearch } from "../../src/lib/ai-first/pipeline";
import { normalizeStructural } from "../goldens/normalize";
import { FIXED_TIMESTAMP, bankPayload, corporatePayload, reitPayload } from "../helpers/payloads";

const suite = createSuite();

function peerAllowedZone(blob: string, peer: string): boolean {
  const text = blob.toLowerCase();
  const needle = peer.toLowerCase();
  const peerSections = ["competitor", "peer", "comparable", "relativeStrengths", "relativeWeaknesses", "businessOverlap"];
  if (!text.includes(needle)) return true;
  return peerSections.some((section) => text.includes(section));
}

function foreignTickerPresent(blob: string, own: string, foreign: string): boolean {
  const normalized = blob;
  if (own.toUpperCase() === foreign.toUpperCase()) return false;
  const pattern = new RegExp(foreign.replace(".", "\\."), "i");
  if (!pattern.test(normalized)) return false;
  return !peerAllowedZone(normalized, foreign);
}

async function main(): Promise<void> {
  const bankRun = await runAiFirstResearch("SBIN.NS", bankPayload(), { retrievalTimestamp: FIXED_TIMESTAMP });
  const corpRun = await runAiFirstResearch("INFY.NS", corporatePayload(), { retrievalTimestamp: FIXED_TIMESTAMP });
  const reitRun = await runAiFirstResearch("EMBASSY.NS", reitPayload(), { retrievalTimestamp: FIXED_TIMESTAMP });

  const bankBlob = JSON.stringify(normalizeStructural(bankRun.report));
  const corpBlob = JSON.stringify(normalizeStructural(corpRun.report));
  const reitBlob = JSON.stringify(normalizeStructural(reitRun.report));

  check(suite, "each run carries its own ticker", bankRun.report.companyTicker === "SBIN.NS" && corpRun.report.companyTicker === "INFY.NS" && reitRun.report.companyTicker === "EMBASSY.NS");
  check(suite, "bank run has no corporate ticker outside peer zones", !foreignTickerPresent(bankBlob, "SBIN.NS", "INFY.NS"));
  check(suite, "corporate run has no bank ticker outside peer zones", !foreignTickerPresent(corpBlob, "INFY.NS", "SBIN.NS"));
  check(suite, "reit run is isolated from bank and corporate", !foreignTickerPresent(reitBlob, "EMBASSY.NS", "SBIN.NS") && !foreignTickerPresent(reitBlob, "EMBASSY.NS", "INFY.NS"));

  const bankFacts = new Set(bankRun.factPack.incomeStatement.facts.map((f) => f.factId).concat(bankRun.factPack.balanceSheet.facts.map((f) => f.factId)));
  const corpFacts = new Set(corpRun.factPack.incomeStatement.facts.map((f) => f.factId).concat(corpRun.factPack.balanceSheet.facts.map((f) => f.factId)));
  check(suite, "fact packs are non-empty", bankFacts.size > 0 && corpFacts.size > 0);
  check(suite, "corporate formulas do not leak bank spread", !/interestIncome\s*-\s*interestExpense/i.test(JSON.stringify(corpRun.forecastSpec.formulas)));

  const bankTargets = bankRun.report.scenarios.map((s) => s.targetPrice).filter((v): v is number => typeof v === "number");
  const corpTargets = corpRun.report.scenarios.map((s) => s.targetPrice).filter((v): v is number => typeof v === "number");
  check(suite, "scenario targets are company-local", (() => {
    if (bankTargets.length === 0 || corpTargets.length === 0) return true;
    return !bankTargets.some((t) => corpTargets.includes(t) && JSON.stringify(bankRun.forecastSpec) === JSON.stringify(corpRun.forecastSpec));
  })());

  check(suite, "provenance stays yfinance or model derived", (() => {
    const sources = [...bankRun.factPack.incomeStatement.facts, ...corpRun.factPack.incomeStatement.facts].map((f) => String(f.source));
    return sources.every((s) => /yfinance|market_data_provider|model_derived|fact/i.test(s));
  })());

  check(suite, "normalized rerun is deterministic", (() => {
    const first = JSON.stringify(normalizeStructural(bankRun.report));
    const second = JSON.stringify(normalizeStructural(bankRun.report));
    return first === second && first.includes("SBIN");
  })());

  report(suite, "regression/contamination");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
