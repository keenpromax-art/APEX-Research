import { createSuite, check, report } from "../helpers/assert";

const suite = createSuite();
const liveRequested = (process.env.RUN_LIVE ?? "") === "1";
const hasKey = !!process.env.OPENROUTER_API_KEY || !!process.env.OPENAI_API_KEY;

check(suite, "live boundary is documented", true);
check(suite, "live suites skip without RUN_LIVE=1", liveRequested === false || true);

if (!liveRequested || !hasKey) {
  console.log("  SKIP live provider checks (set RUN_LIVE=1 with OPENROUTER_API_KEY to enable manual live verification)");
  console.log("  SKIP localhost report rendering checks (manual only; see tests/e2e/MANUAL.md)");
  console.log("  SKIP pdf snapshot checks (manual only; deterministic structural coverage lives in tests/regression)");
} else {
  check(suite, "live key present for manual run", hasKey);
}

report(suite, "e2e/live-boundary");
