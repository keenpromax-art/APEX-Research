import { createSuite, check, report } from "../helpers/assert";
import { buildFactPack, verifyFactPack, hashFactPack, selectLatestFact } from "../../src/lib/ai-first/fact-pack";
import { FIXED_TIMESTAMP, raw, statementRow } from "../helpers/payloads";

const suite = createSuite();

function payload(rows: Record<string, unknown>[]): Record<string, unknown> {
  return {
    price: { longName: "Deterministic Industries", currency: "USD", regularMarketPrice: { raw: 50 }, marketCap: { raw: 5000 } },
    defaultKeyStatistics: { sharesOutstanding: { raw: 100 } },
    incomeStatementHistory: { incomeStatementHistory: rows },
  };
}

const older = statementRow("2023-12-31", { totalRevenue: 100, netIncome: 10 });
const newer = statementRow("2024-12-31", { totalRevenue: 125, netIncome: 15 });
const pack = buildFactPack(payload([older, newer]), "DET", { retrievalTimestamp: FIXED_TIMESTAMP });

check(suite, "fact pack carries ticker", pack.ticker === "DET");
check(suite, "fact pack verifies", verifyFactPack(pack) === true);
check(suite, "latest revenue fact selected", selectLatestFact(pack, "totalRevenue")?.period === "2024-12-31");
check(suite, "period-specific fact ids differ", (() => {
  const a = pack.incomeStatement.facts.find((f) => f.metric === "totalRevenue" && f.period === "2024-12-31")?.factId;
  const b = pack.incomeStatement.facts.find((f) => f.metric === "totalRevenue" && f.period === "2023-12-31")?.factId;
  return !!a && !!b && a !== b;
})());
check(suite, "reversed row order is stable", (() => {
  const reversed = buildFactPack(payload([newer, older]), "DET", { retrievalTimestamp: FIXED_TIMESTAMP });
  return reversed.contentHash === pack.contentHash;
})());
check(suite, "empty payload stays sparse", buildFactPack({}, "EMPTY", { retrievalTimestamp: FIXED_TIMESTAMP }).incomeStatement.facts.length === 0);
check(suite, "nan never becomes zero", (() => {
  const bad = statementRow("2024-12-31", { totalRevenue: 125 });
  (bad as Record<string, unknown>).netIncome = { raw: Number.NaN, fmt: "NaN" };
  const p = buildFactPack(payload([bad]), "DET", { retrievalTimestamp: FIXED_TIMESTAMP });
  return p.incomeStatement.facts.find((f) => f.metric === "netIncome")?.value === undefined;
})());
check(suite, "tampering breaks hash", (() => {
  const tampered = JSON.parse(JSON.stringify(pack)) as Record<string, unknown>;
  tampered.ticker = "FORGED";
  return hashFactPack(tampered) !== pack.contentHash;
})());
check(suite, "pack is frozen", Object.isFrozen(pack) && Object.isFrozen(pack.incomeStatement.facts));
check(suite, "statement and timeseries observations do not share fact ids", (() => {
  const conflicted = buildFactPack({
    price: { longName: "Deterministic Industries", currency: "USD" },
    incomeStatementHistory: { incomeStatementHistory: [statementRow("2024-12-31", { totalRevenue: 125 })] },
    fundamentalsTimeseries: { timeseries: { result: [{ meta: { type: ["annualTotalRevenue"] }, annualTotalRevenue: [{ asOfDate: "2024-12-31", periodType: "12M", reportedValue: raw(126) }] }] } },
  }, "DET", { retrievalTimestamp: FIXED_TIMESTAMP });
  const statement = conflicted.incomeStatement.facts.find((f) => f.metric === "totalRevenue" && f.sourcePath === "quote-summary/income-statement-history");
  const series = conflicted.incomeStatement.facts.find((f) => f.metric === "totalRevenue" && f.sourcePath === "fundamentals-timeseries/annualTotalRevenue");
  return verifyFactPack(conflicted) === true && !!statement?.factId && !!series?.factId && statement.factId !== series.factId && selectLatestFact(conflicted, "totalRevenue")?.factId === statement.factId;
})());
check(suite, "same observation module still rejects conflicting duplicates", (() => {
  try {
    buildFactPack({
      price: { longName: "Deterministic Industries", currency: "USD" },
      incomeStatementHistory: { incomeStatementHistory: [statementRow("2024-12-31", { totalRevenue: 125 }), statementRow("2024-12-31", { totalRevenue: 126 })] },
    }, "DET", { retrievalTimestamp: FIXED_TIMESTAMP });
    return false;
  } catch {
    return true;
  }
})());

report(suite, "unit/fact-pack");
