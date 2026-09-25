import {
  adaptGuidanceReconciliationToRevisions,
  applyGuidanceRevision,
  buildGuidanceRevisionHistory,
  compareGuidance,
  createGuidanceObservation,
  createGuidanceRevision,
  guidanceCoverage,
  guidanceTrackStatus,
  scoreAdaptedGuidance,
  scoreGuidanceAgainstActuals,
} from "../src/lib/research-ledger";
import { buildGuidanceReconciliation } from "../src/lib/guidance-reconciliation";
import { buildManagementCredibilityLedger } from "../src/lib/management-credibility";

const observation = createGuidanceObservation({ id: "G1", companyId: "TEST.NS", metric: "revenueGrowth", period: "FY2027", low: 0.10, high: 0.15, unit: "pct", source: "Annual report", issuedAt: "2026-09-01T00:00:00.000Z" });
const comparisons = compareGuidance([observation], [{ metric: "revenueGrowth", period: "FY2027", value: 0.12, unit: "pct" }]);
if (comparisons.length !== 1 || comparisons[0].status !== "within-range") throw new Error("range comparison failed");
if (guidanceCoverage(comparisons).score !== 1) throw new Error("coverage failed");

const first = createGuidanceRevision({
  id: "GREV-1",
  companyId: "TEST.NS",
  track: "management",
  metric: "revenue",
  period: "FY2027",
  value: 1_000,
  unit: "money",
  source: "FY2027 guidance",
  issuedAt: "2026-01-15T00:00:00.000Z",
  evidenceIds: ["EV-1"],
});
if (first.track !== "management" || first.contentHash.length !== 64) throw new Error("revision creation failed");
if (Object.isFrozen(first) !== true) throw new Error("revision must be frozen");

const revised = createGuidanceRevision({
  id: "GREV-2",
  companyId: "TEST.NS",
  track: "management",
  metric: "revenue",
  period: "FY2027",
  value: 1_150,
  unit: "money",
  source: "FY2027 guidance revision",
  issuedAt: "2026-04-15T00:00:00.000Z",
  supersedesId: "GREV-1",
  revisionReason: "raised after a stronger order book",
});
const withRevision = applyGuidanceRevision([first], revised);
const superseded = withRevision.find((entry) => entry.id === "GREV-1");
if (superseded?.status !== "superseded") throw new Error("supersession must be recorded on the prior revision");
if (withRevision.find((entry) => entry.id === "GREV-2")?.status !== "active") throw new Error("the newest revision stays active");

const withdrawn = createGuidanceRevision({
  id: "GREV-3",
  companyId: "TEST.NS",
  track: "management",
  metric: "revenue",
  period: "FY2027",
  value: 1_150,
  unit: "money",
  source: "FY2027 guidance withdrawal",
  issuedAt: "2026-08-01T00:00:00.000Z",
  status: "withdrawn",
  revisionReason: "withdrawn pending a strategy update",
});
const withWithdrawal = applyGuidanceRevision(withRevision, withdrawn);
if (withWithdrawal.find((entry) => entry.id === "GREV-2")?.status !== "withdrawn") throw new Error("withdrawal must cascade to the prior active revision");

const history = buildGuidanceRevisionHistory(withWithdrawal);
const kinds = history.map((link) => link.kind);
if (JSON.stringify(kinds) !== JSON.stringify(["initial", "supersession", "withdrawal"])) throw new Error(`unexpected revision history ${JSON.stringify(kinds)}`);
if (history[0]?.fromId !== null) throw new Error("the first link has no predecessor");

const tracks = guidanceTrackStatus(withWithdrawal);
if (tracks.management !== "ready" || tracks.consensus !== "unavailable" || tracks.apex !== "unavailable") throw new Error("track status must stay explicit");

const scores = scoreGuidanceAgainstActuals(withWithdrawal, [{ metric: "revenue", period: "FY2027", actual: 1_100, source: "factpack" }]);
if (scores.length !== 0) throw new Error("a withdrawn revision chain must not score");
const activeOnly = withRevision.filter((entry) => entry.status === "active");
if (activeOnly.length !== 1 || activeOnly[0]?.id !== "GREV-2") throw new Error("only the newest active revision should remain scoreable");
const scoresAgain = scoreGuidanceAgainstActuals(activeOnly, [{ metric: "revenue", period: "FY2027", actual: 1_150, source: "factpack" }]);
if (scoresAgain.length !== 1 || scoresAgain[0]?.status !== "met") throw new Error("actual-versus-prior-guidance scoring failed");
const missedScores = scoreGuidanceAgainstActuals(activeOnly, [{ metric: "revenue", period: "FY2027", actual: 1_050, source: "factpack" }]);
if (missedScores[0]?.status !== "missed" || missedScores[0]?.variancePct === null) throw new Error("a miss must record a variance");
const unverified = scoreGuidanceAgainstActuals(activeOnly, [{ metric: "revenue", period: "FY2027", actual: null, source: "factpack" }]);
if (unverified[0]?.status !== "unverified") throw new Error("a missing actual must stay unverified");

const reconciliation = buildGuidanceReconciliation({
  subjectId: "TEST",
  generatedAt: "2026-09-25T12:00:00.000Z",
  points: [
    { track: "historical", metric: "revenue", period: "FY2026", value: 900, unit: "money", issuedAt: "2026-01-01", source: "factpack" },
    { track: "management", metric: "revenue", period: "FY2027", value: 1_000, unit: "money", issuedAt: "2026-01-15", source: "FY2027 guidance" },
    { track: "management", metric: "revenue", period: "FY2027", value: 1_150, unit: "money", issuedAt: "2026-04-15", source: "FY2027 guidance revision", supersedesId: "GREV-1" },
    { track: "consensus", metric: "revenue", period: "FY2027", low: 1_050, high: 1_200, unit: "money", issuedAt: "2026-06-01", source: "Street" },
    { track: "apex", metric: "revenue", period: "FY2027", value: 1_100, unit: "money", issuedAt: "2026-09-01", source: "APEX" },
  ],
  actuals: [{ metric: "revenue", period: "FY2026", actual: 900, source: "factpack" }],
});
if (reconciliation.status !== "ready") throw new Error("four tracks present should reconcile");
if (reconciliation.tracks.historical.points.length !== 1) throw new Error("tracks must not absorb each other");
if (reconciliation.tracks.management.points.length !== 2) throw new Error("both management statements must survive");
const adapted = adaptGuidanceReconciliationToRevisions({ reconciliation, companyId: "TEST.NS", runId: "RUN-1" });
if (adapted.length !== reconciliation.points.length) throw new Error("adaptation must preserve every statement");
if (adapted.every((revision) => revision.companyId === "TEST.NS" && revision.contentHash.length === 64) !== true) throw new Error("adapted revisions must be ledger-sealed");
const adaptedScores = scoreAdaptedGuidance(reconciliation);
if (adaptedScores.length !== reconciliation.scores.filter((score) => score.priorGuidanceId !== null).length) throw new Error("adapted scoring must mirror the reconciliation");

const emptyReconciliation = buildGuidanceReconciliation({ subjectId: "TEST", generatedAt: "2026-09-25T12:00:00.000Z" });
if (emptyReconciliation.status !== "unverified") throw new Error("no guidance must be explicitly unverified");
if (emptyReconciliation.credibility.hitRate !== null) throw new Error("no guidance must not produce a hit rate");

const credibility = buildManagementCredibilityLedger({ subjectId: "TEST.NS", generatedAt: "2026-09-25T12:00:00.000Z" });
if (credibility.status !== "UNVERIFIED" || credibility.score !== null) throw new Error("no management promise must stay UNVERIFIED");

console.log("guidance tracker tests passed");
