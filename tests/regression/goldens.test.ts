import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSuite, check, report } from "../helpers/assert";
import { selectAccountingArchitecture } from "../../src/lib/ai-first/accounting-architecture";
import { VALUATION_METHOD_REGISTRY } from "../../src/lib/ai-first/valuation-methods";
import { normalizeStructural, isNormalizedDeterministic } from "../goldens/normalize";

const suite = createSuite();
const here = path.dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(fs.readFileSync(path.join(here, "..", "goldens", "companies.json"), "utf8")) as {
  version: string;
  companies: Array<{
    ticker: string;
    label: string;
    economicEvidence: string;
    expectedArchitecture: string;
    abstractionPattern: string;
    minimumKpis: string[];
    forbiddenConcepts: string[];
    minimumForecastOutputs: string[];
    valuationConstraints: { applicable: string[]; notApplicable: string[] };
  }>;
};

check(suite, "dataset versioned", dataset.version === "structural-goldens-v1");
check(suite, "dataset covers six architectures", dataset.companies.length === 6);

for (const company of dataset.companies) {
  const selected = selectAccountingArchitecture({ understanding: { whatItDoes: company.economicEvidence, howItMakesMoney: company.economicEvidence }, economicEvidence: [company.economicEvidence] });
  check(suite, `${company.ticker} architecture is ${company.expectedArchitecture}`, selected.id === company.expectedArchitecture, `got ${selected.id}`);
  check(suite, `${company.ticker} abstraction evidence present`, company.economicEvidence.toLowerCase().includes(company.abstractionPattern.toLowerCase()));
  check(suite, `${company.ticker} minimum kpis declared`, company.minimumKpis.length > 0);
  check(suite, `${company.ticker} forbidden concepts excluded from evidence`, company.forbiddenConcepts.every((c) => !company.economicEvidence.toLowerCase().includes(c.toLowerCase())));
  check(suite, `${company.ticker} minimum forecast outputs declared`, company.minimumForecastOutputs.length > 0);
  for (const method of company.valuationConstraints.applicable) {
    const definition = VALUATION_METHOD_REGISTRY[method as keyof typeof VALUATION_METHOD_REGISTRY];
    check(suite, `${company.ticker} ${method} applicable to ${company.expectedArchitecture}`, !!definition && (definition.applicableArchitectures as readonly string[]).includes(company.expectedArchitecture));
  }
  for (const method of company.valuationConstraints.notApplicable) {
    const definition = VALUATION_METHOD_REGISTRY[method as keyof typeof VALUATION_METHOD_REGISTRY];
    check(suite, `${company.ticker} ${method} blocked for ${company.expectedArchitecture}`, !!definition && !(definition.applicableArchitectures as readonly string[]).includes(company.expectedArchitecture));
  }
}

check(suite, "normalization strips volatile metadata", (() => {
  const first = { ticker: "AAA", generationTimestamp: "2026-09-25T12:00:00.000Z", researchRunId: "RUN-AAA", provider: "openrouter", nested: { at: "2026-09-25T13:00:00.000Z", value: 10 } };
  const second = { ticker: "AAA", generationTimestamp: "2026-09-26T00:00:00.000Z", researchRunId: "RUN-BBB", provider: "other", nested: { at: "2026-09-26T01:00:00.000Z", value: 10 } };
  return isNormalizedDeterministic(first, second) && JSON.stringify(normalizeStructural(first)).includes("<STRIPPED>");
})());

check(suite, "normalization preserves economics", (() => {
  const value = { revenue: 100, architecture: "corporate" };
  return JSON.stringify(normalizeStructural(value)) === JSON.stringify(value);
})());

report(suite, "regression/goldens");
