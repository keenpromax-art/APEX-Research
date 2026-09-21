/**
 * Draft-quality layer tests: response contract, deterministic draft audit,
 * repair prompts, and the bounded writer→audit→repair loop.
 * Run: npx tsx scratch/test-draft-quality.ts
 */
import {
  buildResponseContract,
  displayConceptWithAliases,
  auditDraftSections,
  buildRepairPrompt,
  runGuardedDraft,
} from "../src/lib/ai/draft-quality";
import { buildResearchOperatingModel } from "../src/lib/research-model/operating-model";

let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean, extra?: string) => {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.error(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`); }
};

const retailProfile: any = {
  ticker: "ETERNAL.NS", name: "Eternal Limited", sector: "Consumer Cyclical",
  industry: "Internet Retail", country: "India", currency: "INR",
  description: "Technology-enabled logistics and marketplace platform for food delivery and quick commerce",
};
const model = buildResearchOperatingModel({ profile: retailProfile });

console.log("--- 1. Response contract ---");
const contract = buildResponseContract(model);
check("contract names full-form aliases", contract.includes("gross merchandise value") && contract.includes("average order value"));
check("contract states evidence floor", contract.includes("≥2"));
check("contract states numeric law", contract.includes("NUMERIC LAW") && contract.includes("fair value"));
check("contract forbids placeholders", contract.includes("{{PLACEHOLDER}}"));
check("null model yields empty contract", buildResponseContract(null) === "");
check("concept display expands aliases", displayConceptWithAliases("gmv").includes("gross merchandise value"));
check("concept display passes through plain terms", displayConceptWithAliases("fulfillment").includes("fulfilment"));

const goodThesis =
  `Eternal runs India's largest food delivery network with Blinkit quick commerce. ` +
  `Average order value premiumizes as monthly orders scale. Take rate on partners expanded. ` +
  `Gross merchandise value grew on order frequency. Dark store fulfilment density is the moat. ` +
  `Fair value target is Rs. 335.90 vs CMP Rs. 335.90 with upside +0.0% on WACC 11.7%.`;

console.log("--- 2. Draft audit: clean vs defective ---");
check("clean draft passes",
  auditDraftSections(
    { thesis: goodThesis, overview: goodThesis },
    { model, verdict: "HOLD", stanceText: "We reiterate a HOLD with fairly valued assessment.", valuation: { cmp: 335.9, fv: 335.9, upsidePct: 0 } }
  ).length === 0);

const bleed = auditDraftSections(
  { thesis: `${goodThesis} Spectrum auction wins and CASA deposit growth fund tower deployment.` },
  { model }
);
check("forbidden bleed flagged", bleed.some((i) => i.includes("spectrum auction") || i.includes("CASA") || i.includes("Off-sector")));

const thin = auditDraftSections({ thesis: "Good company, buy it.", overview: "" }, { model });
check("thin section flagged", thin.some((i) => i.includes("too thin")));
check("empty section flagged", thin.some((i) => i.includes("EMPTY")));

const leaked = auditDraftSections({ thesis: `${goodThesis} Target {{FAIR_VALUE}} confirmed.` }, { model });
check("placeholder leak flagged", leaked.some((i) => i.includes("PLACEHOLDER")));

const generic = auditDraftSections(
  { thesis: "This industrial manufacturer benefits from strong order backlog and plant utilization tailwinds across its engineering divisions worldwide." },
  { model }
);
check("zero required-concept coverage flagged with usable vocabulary",
  generic.some((i) => i.includes("No required sector concept") && i.includes("gross merchandise value")));

const stanceBad = auditDraftSections(
  { thesis: goodThesis, conclusion: "We issue a strong sell recommendation with underweight stance." },
  { model, verdict: "BUY", stanceText: "We issue a strong sell recommendation with underweight stance." }
);
check("stance contradiction flagged", stanceBad.some((i) => i.includes("SELL-side")));

const numBad = auditDraftSections(
  { thesis: `Fair value target is Rs. 999.00 with solid fundamentals and delivery growth.` },
  { model, valuation: { cmp: 335.9, fv: 335.9, upsidePct: 0 } }
);
check("ungrounded valuation price flagged", numBad.some((i) => i.includes("Ungrounded price")));

const numOk = auditDraftSections(
  { thesis: `Market cap is Rs. 309209 Cr on revenue of Rs. 54364 Cr with steady order growth and fulfilment scale.` },
  { model, valuation: { cmp: 335.9, fv: 335.9, upsidePct: 0 } }
);
check("non-valuation numbers never judged", numOk.filter((i) => i.includes("Ungrounded")).length === 0);

console.log("--- 3. Repair prompt ---");
const repair = buildRepairPrompt({
  companyLabel: "Eternal Limited (ETERNAL.NS)",
  shapeName: "forensic commentary",
  excerpts: [{ name: "thesis", text: "thin" }],
  issues: ["Section \"thesis\" is too thin", "Off-sector term \"spectrum auction\""],
  groundTruth: ["Verdict: HOLD | Fair value: 335.90"],
});
check("repair quotes company + shape", repair.includes("ETERNAL.NS") && repair.includes("forensic commentary"));
check("repair numbers violations", repair.includes("1.") && repair.includes("spectrum auction"));
check("repair carries ground truth", repair.includes("335.90"));

async function runLoopChecks() {
  console.log("--- 4. Guarded loop ---");
  const emptyDraft = { thesis: "", overview: "" };
  const fullDraft = { thesis: goodThesis, overview: goodThesis };
  let calls = 0;
  const looped = await runGuardedDraft({
    writer: async (repairPrompt) => {
      calls++;
      return repairPrompt ? fullDraft : emptyDraft;
    },
    sectionsOf: (d) => ({ thesis: d.thesis, overview: d.overview }),
    auditOpts: { model },
    shapeName: "test",
    companyLabel: "T",
  });
  check("repair path consumed second call", calls === 2 && looped.repaired && looped.attempts === 2);
  check("repaired draft is clean", looped.issues.length === 0 && looped.draft.thesis.length > 0);

  const alwaysEmpty = await runGuardedDraft({
    writer: async () => emptyDraft,
    sectionsOf: (d) => ({ thesis: d.thesis }),
    auditOpts: { model },
    shapeName: "test",
    companyLabel: "T",
  });
  check("always-empty returns last draft with issues", alwaysEmpty.draft.thesis === "" && alwaysEmpty.issues.length > 0);

  let threw = false;
  try {
    await runGuardedDraft({
      writer: async () => { throw new Error("rate limited"); },
      sectionsOf: (d) => d as Record<string, unknown>,
      auditOpts: {},
      shapeName: "test",
      companyLabel: "T",
    });
  } catch { threw = true; }
  check("writer errors propagate (caller owns retries)", threw);
}

runLoopChecks().then(() => {
  console.log(`\nRESULTS: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("ALL DRAFT-QUALITY CHECKS PASSED");
}).catch((e) => { console.error(e); process.exit(1); });
