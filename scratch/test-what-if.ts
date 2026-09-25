import { applyFCFFWhatIf } from "../src/lib/valuation/what-if";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean): void {
  if (condition) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
}

const flat = {
  method: "FCFF_DCF",
  wacc: 0.1,
  terminalGrowthRate: 0.03,
  fcff: [100, 110, 120, 130, 140],
  netDebt: 50,
  sharesOutstanding: 10,
  currentPrice: 20,
};

const unchangedInput = JSON.stringify(flat);
const base = applyFCFFWhatIf(flat);
check("flat base is supported", base.status === "ok" && base.result !== null);
check("base parity is preserved", base.baseParity && base.value === base.baseValue);
check("flat input is not mutated", JSON.stringify(flat) === unchangedInput);

const lowWacc = applyFCFFWhatIf(flat, { wacc: 0.09 });
const highWacc = applyFCFFWhatIf(flat, { wacc: 0.11 });
check("value decreases as WACC rises", lowWacc.value !== null && highWacc.value !== null && lowWacc.value > highWacc.value);
check("changed overlay retains base parity", lowWacc.baseParity && highWacc.baseParity);

const lowGrowth = applyFCFFWhatIf(flat, { terminalGrowthRate: 0.02 });
const highGrowth = applyFCFFWhatIf(flat, { terminalGrowthRate: 0.04 });
check("value increases as terminal growth rises", lowGrowth.value !== null && highGrowth.value !== null && highGrowth.value > lowGrowth.value);

const bounded = applyFCFFWhatIf(flat, { wacc: 0.99, terminalGrowthRate: 0.5 });
check("out-of-range inputs are bounded", bounded.status === "ok" && bounded.bounded?.wacc.clamped === true && bounded.bounded?.terminalGrowth.clamped === true);
check("bounded values remain finite", bounded.value !== null && Number.isFinite(bounded.value));

const strict = applyFCFFWhatIf({ ...flat, boundsMode: "reject" }, { wacc: 0.99 });
check("strict bounds reject out-of-range inputs", strict.status === "invalid_input");

const structuredInput = {
  method: "FCFF_DCF",
  base: {
    assumptions: { wacc: 0.1, terminalGrowthRate: 0.03 },
    projections: [{ fcff: 100 }, { fcff: 110 }, { fcff: 120 }, { fcff: 130 }, { fcff: 140 }],
    netDebt: 50,
    sharesOutstanding: 10,
  },
  overrides: { wacc: 0.1, terminalGrowthRate: 0.03 },
};
const structuredBefore = JSON.stringify(structuredInput);
const structured = applyFCFFWhatIf(structuredInput);
check("structured base parity is exact", structured.status === "ok" && structured.baseParity && structured.value === structured.baseValue);
check("structured input is not mutated", JSON.stringify(structuredInput) === structuredBefore);

const unsupported = applyFCFFWhatIf({ ...flat, method: "RESIDUAL_INCOME" });
check("unsupported methods are explicit", unsupported.status === "unsupported_method" && unsupported.supported === false && unsupported.result === null);

console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
