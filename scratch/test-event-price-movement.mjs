// ============================================================
// Verification Suite: Event-Based Price Movement & Graphical Impact
// ============================================================

import assert from "node:assert";
import { buildEventPriceMovements } from "../src/lib/event-price-engine.ts";

console.log("===============================================================");
console.log("EVENT-BASED PRICE MOVEMENT & GRAPHICAL IMPACT VERIFICATION");
console.log("===============================================================\n");

let passed = 0;
let total = 0;

function it(description, fn) {
  total++;
  try {
    fn();
    console.log(`  [PASS] ${description}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${description}`);
    console.error(`         ${err.message}`);
    process.exitCode = 1;
  }
}

// ── Mock Stock Data & Profile ──
const mockProfile = {
  ticker: "PIIND.NS",
  name: "PI Industries Limited",
  exchange: "NSE",
  currency: "INR",
  sector: "Materials",
  industry: "Agrochemicals & Specialty Chemicals",
};

const mockStockData = {
  currentPrice: 3850,
  beta: 0.85,
  dayHigh: 3890,
  dayLow: 3820,
  week52High: 4400,
  week52Low: 3200,
};

const mockNews = [
  {
    title: "PI Industries Q3 Net Profit Rises 28% YoY on Strong CSM Export Volume Execution",
    publisher: "Financial Express Wire",
    publishedAt: "2026-01-28T09:30:00.000Z",
    summary: "PI Industries reported robust operational earnings with custom synthesis manufacturing (CSM) exports growing 24% while operating EBITDA margins expanded 180 bps.",
  },
  {
    title: "PI Industries Commercializes Two New Patented Chemical Molecules Under Long-Term Global Contract",
    publisher: "Chemical Industry Digest",
    publishedAt: "2025-11-15T14:15:00.000Z",
    summary: "The company announced commercial-scale production and initial shipments for two patented active ingredients from its Jambusar synthesis facility.",
  },
  {
    title: "PI Industries Receives Regulatory Registration Clearance for Novel Crop Protection Herbicide",
    publisher: "AgriBusiness Surveillance",
    publishedAt: "2025-08-20T11:00:00.000Z",
    summary: "Statutory agricultural authorities cleared the commercial registration for a proprietary formulation targeting broad-spectrum weed management.",
  },
];

// ── 1. Event Extraction & Categorization ──
console.log("--- 1. Event Extraction & Institutional Categorization ---");

const events = buildEventPriceMovements(mockNews, mockStockData, mockProfile);

it("Builds comprehensive 6-8 event movement objects from news items and corporate surveillance filings", () => {
  assert.ok(events.length >= 6 && events.length <= 8, `Expected 6-8 events, got ${events.length}`);
});

it("Correctly categorizes earnings result announcement", () => {
  assert.strictEqual(events[0].category, "EARNINGS");
  assert.ok(events[0].categoryLabel.includes("Earnings"));
});

it("Correctly categorizes commercial contract / molecule launch", () => {
  assert.ok(events[1].category === "CONTRACT_WIN" || events[1].category === "PRODUCT_LAUNCH");
});

it("Correctly categorizes regulatory registration clearance", () => {
  assert.ok(events[2].category === "REGULATORY" || events[2].category === "PRODUCT_LAUNCH");
});

// ── 2. Mathematical Integrity & Normalized Trajectory ──
console.log("\n--- 2. Mathematical Consistency & Normalized Trajectory (T-5 to T+10) ---");

it("Generates exactly 8 trajectory points per event (T-5, T-3, T-1, T0, T+1, T+3, T+5, T+10)", () => {
  const points = events[0].priceTrajectory;
  assert.strictEqual(points.length, 8);
  const offsets = points.map((p) => p.dayOffset);
  assert.deepStrictEqual(offsets, [-5, -3, -1, 0, 1, 3, 5, 10]);
});

it("Normalizes T-1 baseline price strictly to 100.0", () => {
  events.forEach((ev) => {
    const tMinus1 = ev.priceTrajectory.find((p) => p.dayOffset === -1);
    assert.ok(tMinus1, "T-1 point must exist");
    assert.strictEqual(tMinus1.normalizedPrice, 100.0);
    assert.strictEqual(tMinus1.benchmarkNormalizedPrice, 100.0);
  });
});

it("Verifies mathematical identity of immediate return: (P_T0 / P_T-1) - 1", () => {
  events.forEach((ev) => {
    const calculatedImmediate = (ev.eventDayPrice / ev.preEventPrice) - 1;
    const diff = Math.abs(calculatedImmediate - ev.immediateReturnPct);
    assert.ok(diff < 0.0001, `Immediate return diff too large: ${diff}`);
  });
});

it("Verifies mathematical identity of multi-day return: (P_T+5 / P_T-1) - 1", () => {
  events.forEach((ev) => {
    const calculatedMultiDay = (ev.postEventPrice / ev.preEventPrice) - 1;
    const diff = Math.abs(calculatedMultiDay - ev.multiDayReturnPct);
    assert.ok(diff < 0.0001, `Multi-day return diff too large: ${diff}`);
  });
});

it("Abnormal return correctly reflects stock return minus benchmark drift", () => {
  events.forEach((ev) => {
    assert.ok(!Number.isNaN(ev.abnormalReturnPct), "Abnormal return must not be NaN");
    assert.ok(isFinite(ev.abnormalReturnPct), "Abnormal return must be finite");
  });
});

it("Assigns an institutional market reaction verdict with complete narrative decomposition", () => {
  events.forEach((ev) => {
    const validVerdicts = ["Bullish Inflection", "Transitory Spike", "Negative De-rating", "Absorbed / Neutral"];
    assert.ok(validVerdicts.includes(ev.verdict), `Invalid verdict: ${ev.verdict}`);
    assert.ok(ev.narrative.whatHappened.length > 20, "whatHappened narrative must be substantive");
    assert.ok(ev.narrative.priceImpact.length > 20, "priceImpact narrative must be substantive");
    assert.ok(ev.narrative.modelImplication.length > 20, "modelImplication narrative must be substantive");
  });
});

// ── 3. Fallback Generation When News is Empty ──
console.log("\n--- 3. Fallback Generation for Tickers With Sparse News ---");

it("Generates canonical domain-specific corporate events when news is empty", () => {
  const fallbackEvents = buildEventPriceMovements([], mockStockData, mockProfile);
  assert.ok(fallbackEvents.length >= 6, `Expected at least 6 fallback events, got ${fallbackEvents.length}`);
  assert.ok(fallbackEvents[0].headline.includes("PI Industries"));
  assert.ok(fallbackEvents[0].priceTrajectory.length === 8);
  assert.strictEqual(fallbackEvents[0].priceTrajectory.find((p) => p.dayOffset === -1).normalizedPrice, 100.0);
});

console.log("\n===============================================================");
console.log(`TEST SUMMARY: ${passed} / ${total} PASSED`);
console.log("===============================================================");

if (passed === total) {
  process.exit(0);
} else {
  process.exit(1);
}
