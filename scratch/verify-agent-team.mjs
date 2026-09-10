import { createRequire } from "module";
import {
  AGENT_TEAM_ROSTER, rosterByFamily, llmRoles,
  buildFactLedger, renderFactLedger, auditCitations, runAgentTeam,
} from "../src/lib/agent-team.ts";

const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS:", name); }
  else { fail++; console.log("FAIL:", name, extra); }
};

// 1. Roster shape: exactly 50, families 10/10/14/10/4/2
check("roster has 50 roles", AGENT_TEAM_ROSTER.length === 50, "got " + AGENT_TEAM_ROSTER.length);
const fam = (f) => rosterByFamily(f).length;
check("families 10/10/14/10/4/2",
  fam("harvest") === 10 && fam("quant") === 10 && fam("author") === 14 &&
  fam("checker") === 10 && fam("design") === 4 && fam("orchestrate") === 2,
  [fam("harvest"), fam("quant"), fam("author"), fam("checker"), fam("design"), fam("orchestrate")].join("/"));
check("26 LLM roles (14 authors + 10 checkers + 2 orchestrators)", llmRoles().length === 26, "got " + llmRoles().length);
check("role ids unique", new Set(AGENT_TEAM_ROSTER.map((r) => r.id)).size === 50);
check("every checker helps ≥1 author", rosterByFamily("checker").every((c) => (c.helps || []).length > 0));
check("checker targets exist in roster",
  rosterByFamily("checker").every((c) => (c.helps || []).every((a) => AGENT_TEAM_ROSTER.some((r) => r.id === a))));

// 2. Fact ledger on static Reliance data (offline, yfinance-grounded)
const d = require("./reliance_data.json");
const ledger = buildFactLedger({ profile: d.profile, stockData: d.stockData, annualFinancials: d.annualFinancials, dcf: d.dcf, moatRating: "None", peers: [] });
const ids = new Set(ledger.map((f) => f.id));
check("ledger has price + mcap + shares", ids.has("F-PRICE") && ids.has("F-MCAP") && ids.has("F-SHARES"));
check("ledger has FY26 revenue + EBITDA", ids.has("F-REV-FY26") && ids.has("F-EBITDA-FY26"));
check("ledger has FV + verdict + peers-insufficient",
  ids.has("F-FV") && ledger.some((f) => f.id === "F-VERDICT") && ledger.some((f) => f.id === "F-PEERS" && f.value === "INSUFFICIENT"));
const text = renderFactLedger(ledger);
check("ledger renders citation contract", text.includes("CITATION CONTRACT") && text.includes("[F-PRICE]"));

// 3. Citation audit: clean prose passes, planted errors fail
const price = ledger.find((f) => f.id === "F-PRICE").value;
const rev26 = ledger.find((f) => f.id === "F-REV-FY26").value;
const clean = `Reliance closed at Rs.${price.toLocaleString("en-IN")} [F-PRICE] on revenue of Rs.${(rev26 / 1e7).toFixed(1)} Cr [F-REV-FY26].`;
const a1 = auditCitations(clean, ledger);
check("clean prose: no uncited, no mismatch", a1.uncitedNumbers.length === 0 && a1.mismatched.length === 0,
  JSON.stringify({ u: a1.uncitedNumbers, m: a1.mismatched }));
const dirty = `Reliance closed at Rs.9,99,999 [F-PRICE] and earned Rs.66,66,666 Cr of moon revenue.`;
const a2 = auditCitations(dirty, ledger);
check("wrong cited value flagged", a2.mismatched.some((m) => m.nearestId === "F-PRICE")), 
check("invented figure flagged uncited", a2.uncitedNumbers.length > 0, JSON.stringify(a2.uncitedNumbers));
const years = `Founded years ago, in FY26 the story continues into 2027 with a 5-star thesis.`;
const a3 = auditCitations(years, ledger);
check("years/small ints skipped", a3.uncitedNumbers.length === 0, JSON.stringify(a3.uncitedNumbers));

// 4. Runner with mocked transport (offline): authors fan out, checkers audit
const roles = [
  ...AGENT_TEAM_ROSTER.filter((r) => ["a-thesis", "a-moat"].includes(r.id)),
  ...AGENT_TEAM_ROSTER.filter((r) => ["c-thesis", "c-moat"].includes(r.id)),
];
const mock = {
  calls: [],
  async complete(prompt, opts) {
    this.calls.push(opts.roleId);
    if (opts.roleId === "a-thesis") return `Thesis at Rs.${price.toLocaleString("en-IN")} [F-PRICE].`;
    if (opts.roleId === "a-moat") return `Moat is nowhere with Rs.66,66,666 Cr fantasy.`;
    return "KEEP all verified.";
  },
};
const res = await runAgentTeam({ roles, ledger, companyName: "Reliance Industries Limited", transport: mock, concurrency: 2 });
check("mock authors both ran", !!res.prose["a-thesis"] && !!res.prose["a-moat"]);
check("team not publishable (fantasy figure)", res.publishable === false && res.blocked.some((b) => b.includes("a-moat")), JSON.stringify(res.blocked));
check("thesis audit clean", !res.blocked.some((b) => b.includes("a-thesis")));

console.log(`\nverify-agent-team: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
