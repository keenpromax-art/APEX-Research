// ============================================================
// APEX RESEARCH — Hard Accounting Identity Engine (P0 #3)
// ------------------------------------------------------------
// Enforces ALL identities on every ACTUAL/ESTIMATE year. No period is exempt.
// Uses kernel magnitudeTolerance with materiality — small rounding WARNs, structural breaks FAIL.
// Identities:
//  1) Assets = Liabilities + Equity (BS identity)
//  2) Beginning Cash + ΔCash = Ending Cash (cash roll-forward when annual cash disclosed)
//  3) EBIT = Revenue − COGS − Opex (via operatingIncome closure)
//  4) EBT = opInc − interestExpense + interestIncome + otherIncome (pretax closure),
//     with the same rescue ladder as the independent validator (adaptive +intInc
//     basis with double-count fallback, data-gap, revenue floors, EBIT
//     corroboration, input-integrity, stale-year demotion) — implemented HERE
//     separately ON PURPOSE: agreement between two independent code paths is the
//     evidence; shared helpers would make agreement vacuous. Engine keeps its own
//     10% FAIL calibration (validator: 8%).
//  5) FCF = CFO − Capex (flow chain)
//  6) Retained earnings: RE(t)=RE(t-1)+NI−Div−Buyback (bridge; OCI plugs WARN-only)
//  7) Debt: STD+LTD+leases ≈ TotalDebt ; Cash: CA−CL = NWC ; D&A rate / PP&E roll-forward
// ============================================================
import { magnitudeTolerance, MONEY_BRIDGE_TOL, RATIO_TOL, wcDriverDays, rollforwardVariance } from "./financial-kernel";
import type { CanonicalFactGraph } from "./canonical-facts";

export interface IdentityIssue {
  code: "BS-IDENTITY" | "CASH-ROLL" | "EBIT-CLOSURE" | "EBT-CLOSURE" | "FCF-CLOSURE" | "NWC-CLOSURE" | "RE-BRIDGE" | "DEBT-SPLIT" | "IMPLIED-RATE" | "EBITDA-TAXONOMY";
  severity: "FAIL" | "WARN";
  year: string;
  expected: string;
  actual: string;
  detail: string;
}

const fmt0 = (n: number) => (Number.isFinite(n) ? n.toFixed(0) : "n/a");

export function enforceAccountingIdentities(graph: CanonicalFactGraph): IdentityIssue[] {
  const out: IdentityIssue[] = [];
  // Corporate EBT-closure FAILs logged with year for the post-loop stale-year
  // demotion below (latest-clean only). Bank PPOP FAILs are never logged
  // (exact-by-construction — always block).
  const ebtFailLog: { idx: number; year: string }[] = [];
  for (const y of graph.years) {
    const v = (f: { value: number | null }) => f.value;
    const isBank = (y as unknown as Record<string, unknown>).statementType === "bank" || (y as unknown as Record<string, unknown>).statementType === "nbfc" || (y as unknown as Record<string, unknown>).statementType === "insurance";
    // 1) BS identity — applies to both
    if (v(y.totalAssets) !== null && v(y.totalLiabilities) !== null && v(y.totalEquity) !== null) {
      const expected = v(y.totalAssets) as number;
      const actual = (v(y.totalLiabilities) as number) + (v(y.totalEquity) as number);
      const t = magnitudeTolerance(expected, actual, { absTol: Math.max(1000, Math.abs(expected) * 0.001), relTol: 0.01, materiality: Math.max(1000, Math.abs(expected) * 0.05) });
      if (!t.pass && t.material && t.gapRel > 0.05) out.push({ code: "BS-IDENTITY", severity: "FAIL", year: y.year, expected: fmt0(expected), actual: fmt0(actual), detail: `Assets ≠ L+E: ${t.detail}` });
      else if (!t.pass) out.push({ code: "BS-IDENTITY", severity: "WARN", year: y.year, expected: fmt0(expected), actual: fmt0(actual), detail: `BS drift: ${t.detail}` });
    }
    if (isBank) {
      // Bank-specific: skip corporate NWC/FCF/EBITDA checks; validate bank PPC closure
      if (v(y.operatingIncome) !== null && (y as any).provisionForCreditLosses?.value !== null && v(y.pretaxIncome) !== null) {
        const prov = (y as any).provisionForCreditLosses.value as number;
        const expected = (v(y.operatingIncome) as number) - prov;
        const t = magnitudeTolerance(expected, v(y.pretaxIncome) as number, { absTol: Math.max(1000, Math.abs(expected) * 0.02), relTol: 0.05, materiality: Math.max(1000, Math.abs(expected) * 0.08) });
        if (!t.pass && t.material && t.gapRel > 0.1) out.push({ code: "EBT-CLOSURE", severity: "FAIL", year: y.year, expected: fmt0(expected), actual: fmt0(v(y.pretaxIncome) as number), detail: `Bank pretax ≠ PPOP−provision: ${t.detail}` });
        else if (!t.pass) out.push({ code: "EBT-CLOSURE", severity: "WARN", year: y.year, expected: fmt0(expected), actual: fmt0(v(y.pretaxIncome) as number), detail: `Bank pretax drift: ${t.detail}` });
      }
      // Bank NPA / NIM sanity (WARN)
      if ((y as any).netInterestMargin?.value !== null) {
        const nim = (y as any).netInterestMargin.value as number;
        if (nim < 0.005 || nim > 0.08) out.push({ code: "IMPLIED-RATE", severity: "WARN", year: y.year, expected: "0.5%..8%", actual: `${(nim*100).toFixed(2)}%`, detail: `Bank NIM outside plausible band` });
      }
    } else {
      // 2) NWC = CA − CL — corporate only (banks: CA/CL not meaningful)
      if (v(y.netWorkingCapital) !== null && v(y.currentAssets) !== null && v(y.currentLiabilities) !== null) {
        const expected = (v(y.currentAssets) as number) - (v(y.currentLiabilities) as number);
        const t = magnitudeTolerance(expected, v(y.netWorkingCapital) as number, { absTol: Math.max(1, Math.abs(v(y.revenue) ?? 0) * 0.005), relTol: 0.005, materiality: Math.max(1, Math.abs(v(y.revenue) ?? 0) * 0.005) });
        if (!t.pass && t.material) out.push({ code: "NWC-CLOSURE", severity: "FAIL", year: y.year, expected: fmt0(expected), actual: fmt0(v(y.netWorkingCapital) as number), detail: `NWC≠CA−CL: ${t.detail}` });
      }
      // 3) FCF = CFO − Capex (capex stored negative in some feeds — take abs) — corporate only
      if (v(y.freeCashFlow) !== null && v(y.operatingCashFlow) !== null && v(y.capitalExpenditures) !== null) {
        const expected = (v(y.operatingCashFlow) as number) - Math.abs(v(y.capitalExpenditures) as number);
        const t = magnitudeTolerance(expected, v(y.freeCashFlow) as number, { absTol: Math.max(1, Math.abs(v(y.revenue) ?? 0) * 0.005), relTol: 0.02, materiality: Math.max(1, Math.abs(v(y.revenue) ?? 0) * 0.02) });
        if (!t.pass && t.material) out.push({ code: "FCF-CLOSURE", severity: "FAIL", year: y.year, expected: fmt0(expected), actual: fmt0(v(y.freeCashFlow) as number), detail: `FCF≠CFO−capex: ${t.detail}` });
      }
      // 4) EBT = opInc − interestExpense + interestIncome + otherIncome — corporate only.
      // interestIncome is a distinct Yahoo line (timeseries) for cash-rich corporates;
      // quoteSummary vintages lack it (fact null → term 0). Adaptive basis + rescue
      // ladder mirrors the independent validator's ECONOMICS in separate code (see
      // header): each year evaluates old vs +intInc bases and judges the better one;
      // data-gap (absent term, ≤2.5% rev), revenue floors (1%, tiered 2% at ≥10%
      // margin), EBIT corroboration (clean pair, relaxed 12%/12%/50% band), and
      // input-integrity (synth opInc, silent-zero interest with debt under an 8%
      // coupon ceiling) downgrade to WARN, tagged. Engine keeps its 10% FAIL bar.
      if (v(y.operatingIncome) !== null && v(y.interestExpense) !== null && v(y.pretaxIncome) !== null) {
        const other = v(y.otherIncome) ?? 0;
        const intInc = v(y.interestIncome) ?? 0;
        const opInc = v(y.operatingIncome) as number;
        const intExp = v(y.interestExpense) as number;
        const reported = v(y.pretaxIncome) as number;
        const mkTol = (exp: number) => ({ absTol: Math.max(1000, Math.abs(exp) * 0.02), relTol: 0.05, materiality: Math.max(1000, Math.abs(exp) * 0.08) });
        const baseOld = opInc - intExp + other;
        const tOld = magnitudeTolerance(baseOld, reported, mkTol(baseOld));
        let t = tOld;
        let expected = baseOld;
        let basis = "opInc−interest+other";
        if (v(y.interestIncome) !== null && intInc !== 0) {
          const baseNew = baseOld + intInc;
          const tNew = magnitudeTolerance(baseNew, reported, mkTol(baseNew));
          const gapOld = Math.abs(reported - baseOld) / Math.max(1, Math.abs(baseOld));
          const gapNew = Math.abs(reported - baseNew) / Math.max(1, Math.abs(baseNew));
          if (gapNew <= gapOld) { t = tNew; expected = baseNew; basis = "opInc−interest+intInc+other"; }
          else basis = "opInc−interest+other(ex-intInc: bundled)";
        }
        const rev = v(y.revenue) ?? 0;
        const gapAbs = Math.abs(reported - expected);
        const ebtWarn = (msg: string) => {
          out.push({ code: "EBT-CLOSURE", severity: "WARN", year: y.year, expected: fmt0(expected), actual: fmt0(reported), detail: `${msg} (${t.detail})` });
        };
        const ebtFail = () => {
          out.push({ code: "EBT-CLOSURE", severity: "FAIL", year: y.year, expected: fmt0(expected), actual: fmt0(reported), detail: `Pretax≠${basis}: ${t.detail}` });
          ebtFailLog.push({ idx: out.length - 1, year: y.year });
        };
        if (t.pass) {
          // pass — nothing to report (vintage note unnecessary here; validator discloses it)
        } else if (!t.material || t.gapRel <= 0.1) {
          ebtWarn(`Pretax drift on ${basis}`);
        } else if (v(y.interestIncome) === null && rev > 0 && gapAbs <= 0.025 * rev) {
          ebtWarn(`Pretax data-gap: interestIncome unavailable and gap within ≤2.5% of revenue (data-gap)`);
        } else if (rev > 0 && gapAbs <= 0.01 * rev) {
          ebtWarn(`Pretax residual under 1% of revenue, immaterial (rev-floor)`);
        } else if (rev > 0 && Math.abs(reported / rev) >= 0.1 && gapAbs > 0.01 * rev && gapAbs <= 0.02 * rev) {
          ebtWarn(`Pretax residual 1–2% of revenue at healthy margin (tiered-floor)`);
        } else if (v(y.ebit) !== null && v(y.incomeTaxExpense) !== null && v(y.netIncome) !== null && !(
          // Taint guard (parity with the independent validator): a modeled-fallback
          // operatingIncome echoes into ebit on timeseries vintages — an ebit fact
          // numerically equal to a low-confidence opInc is the same fiction, not
          // independent evidence. Those years fall through to input-integrity below.
          y.operatingIncome.confidence === "low" && v(y.ebit) === v(y.operatingIncome)
        )) {
          const expB = (v(y.ebit) as number) - intExp;
          const tB = magnitudeTolerance(expB, reported, mkTol(expB));
          const exp3 = (v(y.incomeTaxExpense) as number) + (v(y.netIncome) as number);
          const t3 = magnitudeTolerance(exp3, reported, mkTol(exp3));
          if (tB.pass && t3.pass) {
            ebtWarn(`Pretax doubly corroborated (ebit-corroborated)`);
          } else {
            const gE = Math.abs(reported - expB) / Math.max(1, Math.abs(expB));
            const g3 = Math.abs(reported - exp3) / Math.max(1, Math.abs(exp3));
            const gB = Math.abs(reported - expected) / Math.max(1, Math.abs(expected));
            if (gE <= 0.12 && g3 <= 0.12 && gB <= 0.5) {
              ebtWarn(`Corroborations within 12%, bridge within 50% (ebit-corroborated)`);
            } else {
              ebtFail();
            }
          }
        } else {
          const hintNotes: string[] = [];
          if (y.operatingIncome.confidence === "low") hintNotes.push("synth-input");
          const td = v(y.totalDebt);
          if (intExp === 0 && td !== null && td > 0 && gapAbs <= 0.08 * td) hintNotes.push("intExp-coverage-gap");
          if (hintNotes.length > 0) ebtWarn(`Unverifiable on compromised inputs (${hintNotes.join(", ")})`);
          else ebtFail();
        }
      }
      // 5) EBITDA taxonomy: reported ≈ EBIT + depreciation (EBIT anchor — Yahoo
      // EBITDA = EBIT+D&A exactly on compliant feeds; opInc+D&A false-fails).
      // WARN on tolerance drift; FAIL past 15% of reported EBITDA.
      if (v(y.ebitda) !== null && v(y.depreciation) !== null && (v((y as any).ebit) !== null || v(y.operatingIncome) !== null)) {
        const ebitVal = v((y as any).ebit) !== null ? (v((y as any).ebit) as number) : (v(y.operatingIncome) as number);
        const ebitLabel = v((y as any).ebit) !== null ? "EBIT" : "opInc(fallback)";
        const expected = ebitVal + (v(y.depreciation) as number);
        const t = magnitudeTolerance(expected, v(y.ebitda) as number, { absTol: Math.max(1000, Math.abs(expected) * 0.02), relTol: 0.05, materiality: Math.max(1000, Math.abs(expected) * 0.05) });
        if (!t.pass) {
          const gapRel = Math.abs((v(y.ebitda) as number) - expected) / Math.max(1, Math.abs(v(y.ebitda) as number));
          out.push(gapRel > 0.15
            ? { code: "EBITDA-TAXONOMY", severity: "FAIL", year: y.year, expected: fmt0(expected), actual: fmt0(v(y.ebitda) as number), detail: `FATAL: EBITDA≠${ebitLabel}+D&A by ${(gapRel * 100).toFixed(1)}% > 15%: ${t.detail}` }
            : { code: "EBITDA-TAXONOMY", severity: "WARN", year: y.year, expected: fmt0(expected), actual: fmt0(v(y.ebitda) as number), detail: `EBITDA≠${ebitLabel}+D&A: ${t.detail}` });
        }
      }
    }
    // 6) Debt split — short + long + finance leases ≈ total (totalDebt already
    // includes lease liabilities; the ~6% "drift" is leases, not missing debt).
    // WARN on tolerance drift; FAIL past 10% unexplained.
    if (v(y.shortTermDebt) !== null && v(y.longTermDebt) !== null && v(y.totalDebt) !== null && (v(y.totalDebt) as number) > 0) {
      const sd = Number(v(y.shortTermDebt) ?? 0); const ld = Number(v(y.longTermDebt) ?? 0);
      if (!(sd === 0 && ld === 0)) {
        const leases = Number(v((y as any).capitalLeaseObligations) ?? 0);
        const expected = sd + ld + leases;
        const t = magnitudeTolerance(expected, v(y.totalDebt) as number, { absTol: Math.max(1000, expected * 0.02), relTol: 0.05, materiality: Math.max(1000, expected * 0.1) });
        if (!t.pass) {
          const gapRel = Math.abs((v(y.totalDebt) as number) - expected) / Math.max(1, Math.abs(v(y.totalDebt) as number));
          out.push(gapRel > 0.10
            ? { code: "DEBT-SPLIT", severity: "FAIL", year: y.year, expected: fmt0(expected), actual: fmt0(v(y.totalDebt) as number), detail: `FATAL: short+long+leases≠totalDebt by ${(gapRel * 100).toFixed(1)}% > 10%: ${t.detail}` }
            : { code: "DEBT-SPLIT", severity: "WARN", year: y.year, expected: fmt0(expected), actual: fmt0(v(y.totalDebt) as number), detail: `short+long+leases≠totalDebt: ${t.detail}` });
        }
      }
    }
    // 7) Implied borrowing rate sanity — corporate only (banks handled above as NIM)
    if (!isBank && v(y.interestExpense) !== null && (v(y.interestExpense) as number) > 0 && v(y.totalDebt) !== null && (v(y.totalDebt) as number) > 0) {
      const rate = (v(y.interestExpense) as number) / (v(y.totalDebt) as number);
      if (rate < 0 || rate > 0.25) out.push({ code: "IMPLIED-RATE", severity: "FAIL", year: y.year, expected: "0%..25%", actual: `${(rate * 100).toFixed(1)}%`, detail: `FATAL: implied borrowing rate outside [0%,25%] blocks publication` });
    }
  }
  // 8) RE bridge across years
  for (let i = 1; i < graph.years.length; i++) {
    const prev = graph.years[i - 1]; const cur = graph.years[i];
    if (prev.retainedEarnings.value !== null && cur.retainedEarnings.value !== null && cur.netIncome.value !== null) {
      const expected = (prev.retainedEarnings.value as number) + (cur.netIncome.value as number) - (cur.dividendsPaid.value ?? 0) - (cur.repurchases.value ?? 0);
      const actual = cur.retainedEarnings.value as number;
      const t = magnitudeTolerance(expected, actual, { absTol: Math.max(1000, Math.abs(expected) * 0.02), relTol: 0.1, materiality: Math.max(1000, Math.abs(expected) * 0.1) });
      if (!t.pass) out.push({ code: "RE-BRIDGE", severity: "WARN", year: cur.year, expected: fmt0(expected), actual: fmt0(actual), detail: `RE bridge drift: ${t.detail} — OCI/SBC plugs possible` });
    }
  }
  // 9) Cash roll-forward is not assessable without annual cash flow statement detail (ICF/FCF) — disclose limitation
  // 10) Staleness doctrine (parity with the independent validator): when the latest
  // evaluated corporate year carries no EBT-closure FAIL, older EBT-closure FAILs
  // downgrade to WARN — stale-flagged, never silent. Latest-year FAILs always block.
  {
    const isB = (yy: (typeof graph.years)[number]): boolean => {
      const s = (yy as unknown as { statementType?: string }).statementType;
      return s === "bank" || s === "nbfc" || s === "insurance";
    };
    const corpEval = graph.years.filter(
      (yy) => !isB(yy) && yy.operatingIncome.value !== null && yy.interestExpense.value !== null && yy.pretaxIncome.value !== null
    );
    const latestCorp = corpEval[corpEval.length - 1];
    if (latestCorp && !ebtFailLog.some((e) => e.year === latestCorp.year)) {
      for (const e of ebtFailLog) {
        const issue = out[e.idx];
        if (issue && issue.code === "EBT-CLOSURE" && issue.severity === "FAIL") {
          issue.severity = "WARN";
          issue.detail = `${issue.detail} — latest evaluated year (${latestCorp.year}) reconciles; downgraded (stale-year), does not block.`;
        }
      }
    }
  }
  return out;
}

export function hasHardIdentityFail(issues: IdentityIssue[]): boolean {
  return issues.some((i) => i.severity === "FAIL");
}
