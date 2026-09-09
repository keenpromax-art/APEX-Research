// ============================================================
// Sector-Native PDF Statement Sections (Architectures B–E)
// Each architecture renders its own income-statement, balance-sheet, and
// key-ratio tables — REPLACING the generic corporate tables for that sector,
// never layering narrative on top of corporate line items. Architecture A
// (standard corporate) never reaches this file (see shouldUseNativeStatements).
// Conventions: money in currency Millions (same as corporate pages); ratios as
// %; undisclosed unit economics (occupancy, AUM, solvency) render N/M — never
// synthesized. Every proxied field is footnoted via estimatesUsed tags.
// ============================================================
import React from "react";
import { Text, View } from "@react-pdf/renderer";
import { pdfStyles as S, COLORS } from "./pdfStyles";
import type {
  ReportData,
  AnnualFinancials,
  BankAnnualFinancials,
  InsuranceAnnualFinancials,
  ReitAnnualFinancials,
  AssetLightFeeAnnualFinancials,
  StatementArchitecture,
} from "@/types/report";
import {
  getStatementArchitecture,
  stmtNum,
  isBankStatement,
  isInsuranceStatement,
  isReitStatement,
  isAssetLightStatement,
} from "@/types/report";
import {
  computeBankRatios,
  computeInsuranceRatios,
  computeReitRatios,
  computeAssetLightRatios,
} from "@/lib/calculations";
import {
  buildBankDriverSet,
  buildInsuranceDriverSet,
  buildReitDriverSet,
  buildAssetLightDriverSet,
} from "@/lib/driver-models";
import { classifySector } from "@/lib/sectors";
import { getArchitectureForSector } from "@/lib/sectors/architectures";

// ── Local formatters (mirror index.tsx conventions) ──
const fmtNum = (n: number, d = 0) =>
  isFinite(n) && !isNaN(n)
    ? n.toLocaleString("en", { minimumFractionDigits: d, maximumFractionDigits: d })
    : "—";
const fmtPct = (n: number) =>
  isFinite(n) && !isNaN(n) ? `${(n * 100).toFixed(1)}%` : "—";
const fmtPctNA = (v: number | null | undefined): string =>
  v === null || v === undefined || !isFinite(v) ? "N/M" : fmtPct(v);
const toMil = (n: number) => {
  if (!isFinite(n) || isNaN(n)) return 0;
  return Math.abs(n) >= 1e5 ? Math.round(n / 1e6) : Math.round(n);
};
const shortYear = (label: string) => label.replace("FY20", "FY").replace("(E)", "E");

/** Routing authority for PDF statement pages. */
export function getReportArchitecture(data: ReportData): StatementArchitecture {
  const fins = data.annualFinancials || [];
  const latest = fins[fins.length - 1];
  if (latest) return getStatementArchitecture(latest);
  const sectorProfile = classifySector(data.profile.sector, data.profile.industry, data.profile.description);
  return getArchitectureForSector(sectorProfile.id).arch;
}

/** True for architectures B–E (native pages replace corporate ones). */
export function shouldUseNativeStatements(data: ReportData): boolean {
  return getReportArchitecture(data) !== "A";
}

interface NativeRow {
  label: string;
  kind: "money" | "pct" | "multiple" | "shares";
  bold?: boolean;
  get: (f: AnnualFinancials) => number | null | undefined;
}

function NativeTable({ columns, rows, fins }: { columns: string[]; rows: NativeRow[]; fins: AnnualFinancials[] }) {
  const cell = (r: NativeRow, f: AnnualFinancials): string => {
    const v = r.get(f);
    if (v === null || v === undefined || !isFinite(v)) return r.kind === "pct" || r.kind === "multiple" ? "N/M" : "—";
    if (r.kind === "pct") return fmtPct(v);
    if (r.kind === "multiple") return v !== 0 ? `${v.toFixed(1)}x` : "—";
    if (r.kind === "shares") return fmtNum(v, 0);
    return fmtNum(toMil(v), 0);
  };
  return (
    <View style={[S.compactTable, { marginBottom: 3 }]}>
      <View style={S.compactRowHeader}>
        <Text style={[S.compactCellHeader, { width: "33%" }]}>Line Item</Text>
        {columns.map((c, i) => (
          <Text key={i} style={[S.compactCellHeaderRight, { flex: 1, paddingRight: 3, fontSize: 5.4 }]}>
            {shortYear(c)}
          </Text>
        ))}
      </View>
      {rows.map((r, ri) => (
        <View key={ri} style={ri % 2 === 0 ? S.compactRow : S.compactRowAlt}>
          <Text style={[r.bold ? S.compactCellBold : S.compactCell, { width: "33%" }]}>{r.label}</Text>
          {fins.map((f, ci) => (
            <Text key={ci} style={[r.bold ? S.compactCellBoldRight : S.compactCellRight, { flex: 1, paddingRight: 3, fontSize: 5.4 }]}>
              {cell(r, f)}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function NativeFootnote({ fins }: { fins: AnnualFinancials[] }) {
  const tags = Array.from(new Set((fins || []).flatMap((f) => f.estimatesUsed || [])));
  if (tags.length === 0) {
    return (
      <Text style={{ fontSize: 5.0, color: COLORS.textMuted, marginTop: 1, marginBottom: 3 }}>
        All line items reported (no modeled fallbacks in this statement).
      </Text>
    );
  }
  return (
    <Text style={{ fontSize: 5.0, color: COLORS.textMuted, marginTop: 1, marginBottom: 3 }}>
      Modeled inputs (not reported — see QA appendix): {tags.slice(0, 10).join("; ")}{tags.length > 10 ? `; +${tags.length - 10} more` : ""}.
      Undisclosed unit economics (occupancy, AUM scale, solvency) print N/M, never synthesized.
    </Text>
  );
}

function DriverBox({ equation, basis }: { equation: string; basis: Record<string, string> }) {
  return (
    <View style={{ padding: 5.5, backgroundColor: COLORS.offWhite, borderWidth: 0.5, borderColor: COLORS.hairlineLight, marginBottom: 3 }}>
      <Text style={{ fontSize: 7.2, fontFamily: "Helvetica-Bold", color: COLORS.slateDark, marginBottom: 1.5 }}>
        Sector-Native Forecast Drivers (operating drivers, not generic revenue/EBIT)
      </Text>
      <Text style={{ fontSize: 6.4, color: COLORS.textSecondary, lineHeight: 1.35, marginBottom: 1.5 }}>
        {equation}
      </Text>
      {Object.entries(basis).map(([k, v]) => (
        <Text key={k} style={{ fontSize: 6.2, color: COLORS.textSecondary, lineHeight: 1.35 }}>
          • {k}: {v}
        </Text>
      ))}
    </View>
  );
}

// ── Per-architecture row definitions ──
const M = (label: string, get: (f: AnnualFinancials) => number | null | undefined, bold = false): NativeRow =>
  ({ label, kind: "money", bold, get });
const P = (label: string, get: (f: AnnualFinancials) => number | null | undefined, bold = false): NativeRow =>
  ({ label, kind: "pct", bold, get });
const X = (label: string, get: (f: AnnualFinancials) => number | null | undefined, bold = false): NativeRow =>
  ({ label, kind: "multiple", bold, get });

function bankIncomeRows(): NativeRow[] {
  const g = (f: AnnualFinancials) => (isBankStatement(f) ? (f as BankAnnualFinancials) : null);
  return [
    M("Net Interest Income (NII)", (f) => g(f)?.netInterestIncome, true),
    M("Non-Interest Income (fees, treasury)", (f) => g(f)?.nonInterestIncome),
    M("Total Revenue (NII + fees)", (f) => g(f)?.totalRevenue, true),
    M("Operating Expenses (staff, opex)", (f) => g(f)?.nonInterestExpenses),
    M("Pre-Provision Operating Profit (PPOP)", (f) => g(f)?.operatingIncome, true),
    M("Provisions for Credit Losses", (f) => g(f)?.provisionForCreditLosses),
    M("Pre-Tax Income", (f) => g(f)?.pretaxIncome, true),
    M("Income Tax Expense", (f) => g(f)?.incomeTaxExpense),
    M("Net Income (PAT)", (f) => g(f)?.netIncome, true),
    { label: "Diluted EPS", kind: "money", get: (f) => g(f)?.dilutedEps },
    M("Dividends Paid", (f) => g(f)?.dividendsPaid),
  ];
}

function bankRatioRows(cmp: number): NativeRow[] {
  const r = (f: AnnualFinancials) => (isBankStatement(f) ? computeBankRatios(f as BankAnnualFinancials, cmp) : null);
  return [
    P("Net Interest Margin (NIM) %", (f) => r(f)?.nim, true),
    P("Cost-to-Income %", (f) => r(f)?.costToIncome, true),
    P("Net Margin %", (f) => r(f)?.netMargin),
    P("Return on Assets (ROA) %", (f) => r(f)?.roa),
    P("Return on Equity (ROE) %", (f) => r(f)?.roe, true),
    X("Equity Multiplier (Assets/Equity)", (f) => r(f)?.equityMultiplier),
    P("Gross NPA %", (f) => r(f)?.gnpaPct ?? null),
    P("Net NPA %", (f) => r(f)?.nnpaPct ?? null),
    P("Capital Adequacy (CRAR) %", (f) => r(f)?.capitalAdequacy ?? null),
    X("Price / Book", (f) => r(f)?.pb),
    X("Price / Earnings", (f) => (r(f)?.pe || 0) > 0 ? r(f)?.pe : null),
    P("Dividend Yield %", (f) => r(f)?.dividendYield),
  ];
}

function bankBalanceRows(): NativeRow[] {
  const g = (f: AnnualFinancials) => (isBankStatement(f) ? (f as BankAnnualFinancials) : null);
  return [
    M("Net Loans & Advances", (f) => g(f)?.loans, true),
    M("Customer Deposits", (f) => g(f)?.deposits, true),
    M("Borrowings (non-deposit debt)", (f) => g(f)?.totalDebt),
    M("Total Assets", (f) => g(f)?.totalAssets, true),
    M("Total Liabilities", (f) => g(f)?.totalLiabilities),
    M("Total Equity (book value)", (f) => g(f)?.totalEquity, true),
    M("Cash & Balances", (f) => g(f)?.cash),
  ];
}

function insuranceIncomeRows(): NativeRow[] {
  const g = (f: AnnualFinancials) => (isInsuranceStatement(f) ? (f as InsuranceAnnualFinancials) : null);
  return [
    M("Gross Written Premium (GWP)", (f) => g(f)?.grossWrittenPremium, true),
    M("Net Earned Premium (NEP)", (f) => g(f)?.netEarnedPremium, true),
    M("Claims Incurred (losses)", (f) => g(f)?.claimsIncurred),
    M("Underwriting Expenses", (f) => g(f)?.underwritingExpenses),
    M("Underwriting Result", (f) => g(f)?.underwritingResult, true),
    M("Investment Income on Float", (f) => g(f)?.investmentIncome),
    M("Pre-Tax Income", (f) => g(f)?.pretaxIncome, true),
    M("Income Tax Expense", (f) => g(f)?.incomeTaxExpense),
    M("Net Income (PAT)", (f) => g(f)?.netIncome, true),
    { label: "Diluted EPS", kind: "money", get: (f) => g(f)?.dilutedEps },
    M("Dividends Paid", (f) => g(f)?.dividendsPaid),
  ];
}

function insuranceRatioRows(cmp: number): NativeRow[] {
  const r = (f: AnnualFinancials) => (isInsuranceStatement(f) ? computeInsuranceRatios(f as InsuranceAnnualFinancials, cmp) : null);
  return [
    P("Loss Ratio %", (f) => r(f)?.lossRatio, true),
    P("Expense Ratio %", (f) => r(f)?.expenseRatio, true),
    P("Combined Ratio %", (f) => r(f)?.combinedRatio, true),
    P("Underwriting Margin %", (f) => r(f)?.underwritingMargin, true),
    P("Investment Yield on Float %", (f) => r(f)?.investmentYieldOnFloat),
    P("Net Margin %", (f) => r(f)?.netMargin),
    P("Return on Equity (ROE) %", (f) => r(f)?.roe, true),
    P("Return on Assets (ROA) %", (f) => r(f)?.roa),
    X("Leverage (Assets/Equity)", (f) => r(f)?.leverage),
    P("Solvency Ratio %", (f) => r(f)?.solvencyRatio ?? null),
    X("Price / Book", (f) => r(f)?.pb),
    X("Price / Earnings", (f) => (r(f)?.pe || 0) > 0 ? r(f)?.pe : null),
  ];
}

function insuranceBalanceRows(): NativeRow[] {
  const g = (f: AnnualFinancials) => (isInsuranceStatement(f) ? (f as InsuranceAnnualFinancials) : null);
  return [
    M("Policyholder Float (investable)", (f) => g(f)?.float, true),
    M("Policyholder Liabilities & Reserves", (f) => g(f)?.policyholderLiabilities, true),
    M("Non-Policyholder Borrowings", (f) => g(f)?.totalDebt),
    M("Total Assets", (f) => g(f)?.totalAssets, true),
    M("Total Liabilities", (f) => g(f)?.totalLiabilities),
    M("Total Equity", (f) => g(f)?.totalEquity, true),
    M("Embedded Value (if disclosed)", (f) => g(f)?.embeddedValue ?? null),
    M("Cash & Equivalents", (f) => g(f)?.cash),
  ];
}

function reitIncomeRows(): NativeRow[] {
  const g = (f: AnnualFinancials) => (isReitStatement(f) ? (f as ReitAnnualFinancials) : null);
  return [
    M("Rental Income", (f) => g(f)?.rentalIncome, true),
    M("Property Operating Expenses", (f) => g(f)?.propertyOperatingExpenses),
    M("Net Operating Income (NOI)", (f) => g(f)?.netOperatingIncome, true),
    M("Corporate G&A", (f) => g(f)?.generalAdministrative),
    M("Interest Expense", (f) => g(f)?.interestExpense),
    M("Net Income", (f) => g(f)?.netIncome, true),
    M("Funds From Operations (FFO)", (f) => g(f)?.fundsFromOperations, true),
    M("Maintenance Capex & Leasing Reserve", (f) => (g(f)?.maintenanceCapex || 0) + (g(f)?.leasingCommissions || 0)),
    M("Adjusted FFO (AFFO)", (f) => g(f)?.adjustedFundsFromOperations, true),
    { label: "FFO / Share", kind: "money", get: (f) => g(f)?.ffoPerShare },
    { label: "AFFO / Share", kind: "money", get: (f) => g(f)?.affoPerShare },
    M("Distributions Paid", (f) => g(f)?.dividendsPaid, true),
  ];
}

function reitRatioRows(cmp: number): NativeRow[] {
  const r = (f: AnnualFinancials) => (isReitStatement(f) ? computeReitRatios(f as ReitAnnualFinancials, cmp) : null);
  return [
    P("NOI Margin %", (f) => r(f)?.noiMargin, true),
    P("FFO Margin %", (f) => r(f)?.ffoMargin, true),
    P("AFFO Margin %", (f) => r(f)?.affoMargin, true),
    X("Price / FFO", (f) => (r(f)?.priceToFfo || 0) > 0 ? r(f)?.priceToFfo : null, true),
    X("Price / AFFO", (f) => (r(f)?.priceToAffo || 0) > 0 ? r(f)?.priceToAffo : null, true),
    P("Distribution Yield %", (f) => r(f)?.dividendYield),
    P("AFFO Payout %", (f) => r(f)?.affoPayout),
    P("Return on Equity (ROE) %", (f) => r(f)?.roe),
    X("Debt / Assets", (f) => r(f)?.debtToAssets),
    X("NOI Interest Cover", (f) => (r(f)?.noiInterestCover || 0) > 0 ? r(f)?.noiInterestCover : null),
    P("Occupancy %", (f) => r(f)?.occupancyPct ?? null),
    P("Cap Rate %", (f) => r(f)?.capRate ?? null),
  ];
}

function reitBalanceRows(): NativeRow[] {
  const g = (f: AnnualFinancials) => (isReitStatement(f) ? (f as ReitAnnualFinancials) : null);
  return [
    M("Investment Property Value", (f) => g(f)?.investmentPropertyValue, true),
    M("Total Assets", (f) => g(f)?.totalAssets, true),
    M("Total Debt", (f) => g(f)?.totalDebt, true),
    M("Total Liabilities", (f) => g(f)?.totalLiabilities),
    M("Total Equity", (f) => g(f)?.totalEquity, true),
    M("Net Asset Value (if disclosed)", (f) => g(f)?.netAssetValue ?? null),
    M("Cash & Equivalents", (f) => g(f)?.cash),
  ];
}

function feeIncomeRows(): NativeRow[] {
  const g = (f: AnnualFinancials) => (isAssetLightStatement(f) ? (f as AssetLightFeeAnnualFinancials) : null);
  return [
    M("Management / Advisory Fees", (f) => g(f)?.managementFees, true),
    M("Performance / Incentive Fees", (f) => g(f)?.performanceFees),
    M("Technology / Platform Services", (f) => g(f)?.technologyServicesRevenue),
    M("Total Fee Revenue", (f) => g(f)?.totalFeeRevenue, true),
    M("Operating Expenses", (f) => g(f)?.operatingExpenses),
    M("Operating Income", (f) => g(f)?.operatingIncome, true),
    M("Pre-Tax Income", (f) => g(f)?.pretaxIncome, true),
    M("Income Tax Expense", (f) => g(f)?.incomeTaxExpense),
    M("Net Income (PAT)", (f) => g(f)?.netIncome, true),
    { label: "Diluted EPS", kind: "money", get: (f) => g(f)?.dilutedEps },
    M("Dividends & Buybacks Paid", (f) => g(f)?.dividendsPaid),
  ];
}

function feeRatioRows(cmp: number): NativeRow[] {
  const r = (f: AnnualFinancials) => (isAssetLightStatement(f) ? computeAssetLightRatios(f as AssetLightFeeAnnualFinancials, cmp) : null);
  return [
    P("Operating Margin %", (f) => r(f)?.operatingMargin, true),
    P("Net Margin %", (f) => r(f)?.netMargin),
    P("Revenue as % of AUM", (f) => (stmtNumSafe(f) ? r(f)?.revenueAsPctOfAum : null)),
    P("Return on Equity (ROE) %", (f) => r(f)?.roe, true),
    P("Return on Assets (ROA) %", (f) => r(f)?.roa),
    X("FCF Conversion (FCF/NI)", (f) => r(f)?.fcfConversion),
    X("Asset Turnover", (f) => r(f)?.assetTurnover),
    X("Price / Earnings", (f) => (r(f)?.pe || 0) > 0 ? r(f)?.pe : null),
    X("Price / Book", (f) => r(f)?.pb),
    P("Dividend Yield %", (f) => r(f)?.dividendYield),
    P("Dividend Payout %", (f) => r(f)?.dividendPayout),
  ];
}

function stmtNumSafe(f: AnnualFinancials): boolean {
  if (!isAssetLightStatement(f)) return false;
  const a = f as AssetLightFeeAnnualFinancials;
  return (a.aumBeginning + a.aumEnding) / 2 > 0;
}

function feeBalanceRows(): NativeRow[] {
  const g = (f: AnnualFinancials) => (isAssetLightStatement(f) ? (f as AssetLightFeeAnnualFinancials) : null);
  return [
    M("Ending AUM (if disclosed)", (f) => {
      const a = g(f);
      return a && a.aumEnding > 0 ? a.aumEnding : null;
    }),
    M("Net Flows (if disclosed)", (f) => {
      const a = g(f);
      return a && (a.aumBeginning + a.aumEnding) > 0 ? a.netFlows : null;
    }),
    M("Total Assets", (f) => g(f)?.totalAssets, true),
    M("Total Debt (minimal by construction)", (f) => g(f)?.totalDebt),
    M("Total Liabilities", (f) => g(f)?.totalLiabilities),
    M("Total Equity", (f) => g(f)?.totalEquity, true),
    M("Cash & Equivalents", (f) => g(f)?.cash),
  ];
}

// ── Public section components ──

const ARCH_TITLES: Record<Exclude<StatementArchitecture, "A">, { income: string; balance: string; ratios: string; cashflow: string }> = {
  B: {
    income: "Income Statement — Bank-Native (NII / PPOP / Provisions)",
    balance: "Balance Sheet — Bank-Native (Loans / Deposits / Book Value)",
    ratios: "Key Ratios — Bank-Native (NIM / Cost-to-Income / Asset Quality / Capital)",
    cashflow: "Cash Flows & Distributions — Bank Presentation (FCF≈CFO informational)",
  },
  C: {
    income: "Income Statement — Insurance-Native (GWP / NEP / Underwriting / Float)",
    balance: "Balance Sheet — Insurance-Native (Float / Policyholder Reserves)",
    ratios: "Key Ratios — Insurance-Native (Combined Ratio / Float Yield / Solvency)",
    cashflow: "Cash Flows & Distributions — Insurance Presentation",
  },
  D: {
    income: "Income Statement — REIT-Native (Rental / NOI / FFO / AFFO)",
    balance: "Balance Sheet — REIT-Native (Investment Property / NAV-Basis Leverage)",
    ratios: "Key Ratios — REIT-Native (NOI Margin / P-FFO / P-AFFO / AFFO Payout)",
    cashflow: "Cash Flows & Distributions — REIT Presentation",
  },
  E: {
    income: "Income Statement — Fee-Native (AUM Fees / Operating Leverage)",
    balance: "Balance Sheet — Fee-Native (Asset-Light; Minimal Debt/WC)",
    ratios: "Key Ratios — Fee-Native (Operating Margin / Fee Rate / FCF Conversion)",
    cashflow: "Cash Flows & Distributions — Fee-Franchise Presentation",
  },
};

function sectionTitle(text: string) {
  return (
    <Text style={{ fontSize: 7.2, fontFamily: "Helvetica-Bold", color: COLORS.slateDark, marginBottom: 2 }}>
      {text}
    </Text>
  );
}

export function SectorIncomeContent({ data }: { data: ReportData }) {
  const arch = getReportArchitecture(data) as Exclude<StatementArchitecture, "A">;
  const fins = data.annualFinancials || [];
  const columns = fins.map((f) => f.year);
  const cmp = data.cmp || data.stockData.currentPrice;
  const incomeRows = arch === "B" ? bankIncomeRows() : arch === "C" ? insuranceIncomeRows() : arch === "D" ? reitIncomeRows() : feeIncomeRows();
  const ratioRows = arch === "B" ? bankRatioRows(cmp) : arch === "C" ? insuranceRatioRows(cmp) : arch === "D" ? reitRatioRows(cmp) : feeRatioRows(cmp);
  const drivers = arch === "B"
    ? buildBankDriverSet({
      loans: fins.map((f) => stmtNum(f, "loans")),
      netInterestIncome: fins.map((f) => stmtNum(f, "netInterestIncome")),
      totalRevenue: fins.map((f) => f.revenue),
      nonInterestExpenses: fins.map((f) => stmtNum(f, "nonInterestExpenses")),
      provisions: fins.map((f) => stmtNum(f, "provisionForCreditLosses")),
    })
    : arch === "C"
      ? buildInsuranceDriverSet({
        gwp: fins.map((f) => stmtNum(f, "grossWrittenPremium")),
        lossRatio: fins.map((f) => stmtNum(f, "lossRatio")),
        expenseRatio: fins.map((f) => stmtNum(f, "expenseRatio")),
        investmentIncome: fins.map((f) => stmtNum(f, "investmentIncome")),
        float: fins.map((f) => stmtNum(f, "float")),
      })
      : arch === "D"
        ? buildReitDriverSet({
          rental: fins.map((f) => f.revenue),
          noiMargin: fins.map((f) => stmtNum(f, "noiMargin")),
          ffoPerShare: fins.map((f) => stmtNum(f, "ffoPerShare")),
        })
        : buildAssetLightDriverSet({
          feeRevenue: fins.map((f) => f.revenue),
          operatingMargin: fins.map((f) => stmtNum(f, "operatingMargin")),
          fcfConversion: fins.map((f) => {
            const ni = f.netIncome;
            return ni !== 0 ? f.freeCashFlow / ni : 0;
          }),
        });
  return (
    <>
      {sectionTitle(`${ARCH_TITLES[arch].income} (${data.profile.currency} Millions)`)}
      <NativeTable columns={columns} rows={incomeRows} fins={fins} />
      <NativeFootnote fins={fins} />
      {sectionTitle(ARCH_TITLES[arch].ratios)}
      <NativeTable columns={columns} rows={ratioRows} fins={fins} />
      <DriverBox equation={drivers.driverEquation} basis={drivers.basis} />
    </>
  );
}

export function SectorBalanceContent({ data }: { data: ReportData }) {
  const arch = getReportArchitecture(data) as Exclude<StatementArchitecture, "A">;
  const fins = data.annualFinancials || [];
  const columns = fins.map((f) => f.year);
  const rows = arch === "B" ? bankBalanceRows() : arch === "C" ? insuranceBalanceRows() : arch === "D" ? reitBalanceRows() : feeBalanceRows();
  return (
    <>
      {sectionTitle(`${ARCH_TITLES[arch].balance} (${data.profile.currency} Millions)`)}
      <NativeTable columns={columns} rows={rows} fins={fins} />
      <NativeFootnote fins={fins} />
    </>
  );
}

export function SectorCashFlowContent({ data }: { data: ReportData }) {
  const arch = getReportArchitecture(data) as Exclude<StatementArchitecture, "A">;
  const fins = data.annualFinancials || [];
  const columns = fins.map((f) => f.year);
  const distLabel = arch === "D" ? "Distributions to Holders" : arch === "B" ? "Dividends Paid (CET1-gated)" : "Dividends Paid";
  const rows: NativeRow[] = [
    M("Operating Cash Flow", (f) => f.operatingCashFlow, true),
    M("Investing Cash Flow", (f) => f.investingCashFlow),
    M("Financing Cash Flow", (f) => f.financingCashFlow),
    M("Capital Expenditures", (f) => Math.abs(f.capitalExpenditures)),
    M("Free Cash Flow (CFO − capex)", (f) => f.freeCashFlow, arch === "E"),
    M(distLabel, (f) => Math.abs(f.dividendsPaid), true),
    M("Change in Cash", (f) => f.changeInCash),
  ];
  const note = arch === "B" || arch === "C"
    ? "Banks/insurers do not reconcile via FCF = CFO − capex: loan-book and policyholder flows dominate operating cash flow, so FCF≈CFO is informational only (QA CHAIN-01/IND-02 treat it as WARN, never FAIL)."
    : arch === "D"
      ? "AFFO (not FCF) is the distribution-capacity KPI — see the REIT income section. Distributions above AFFO are a return OF capital."
      : "FCF conversion (FCF/NI) is a core fee-franchise KPI: capex-light by construction, conversion near 100% corroborates earnings quality.";
  return (
    <>
      {sectionTitle(`${ARCH_TITLES[arch].cashflow} (${data.profile.currency} Millions)`)}
      <NativeTable columns={columns} rows={rows} fins={fins} />
      <Text style={{ fontSize: 5.0, color: COLORS.textMuted, marginTop: 1, marginBottom: 3 }}>{note}</Text>
      <NativeFootnote fins={fins} />
    </>
  );
}

/** Compact native KPI strip for cover/fundamental pages (never corporate margins for native archs). */
export function sectorKpiSummary(data: ReportData): { label: string; value: string }[] {
  const arch = getReportArchitecture(data);
  const fins = data.annualFinancials || [];
  const latest = fins[fins.length - 1];
  if (!latest) return [];
  const cmp = data.cmp || data.stockData.currentPrice;
  if (arch === "B" && isBankStatement(latest)) {
    const r = computeBankRatios(latest, cmp);
    return [
      { label: "NIM", value: fmtPctNA(r.nim) },
      { label: "Cost/Income", value: fmtPctNA(r.costToIncome) },
      { label: "ROE", value: fmtPctNA(r.roe) },
      { label: "P/B", value: r.pb > 0 ? `${r.pb.toFixed(1)}x` : "N/M" },
    ];
  }
  if (arch === "C" && isInsuranceStatement(latest)) {
    const r = computeInsuranceRatios(latest, cmp);
    return [
      { label: "Combined", value: fmtPctNA(r.combinedRatio) },
      { label: "UW Margin", value: fmtPctNA(r.underwritingMargin) },
      { label: "Float Yield", value: fmtPctNA(r.investmentYieldOnFloat) },
      { label: "ROE", value: fmtPctNA(r.roe) },
    ];
  }
  if (arch === "D" && isReitStatement(latest)) {
    const r = computeReitRatios(latest, cmp);
    return [
      { label: "NOI Margin", value: fmtPctNA(r.noiMargin) },
      { label: "P/FFO", value: (r.priceToFfo || 0) > 0 ? `${r.priceToFfo.toFixed(1)}x` : "N/M" },
      { label: "P/AFFO", value: (r.priceToAffo || 0) > 0 ? `${r.priceToAffo.toFixed(1)}x` : "N/M" },
      { label: "AFFO Payout", value: fmtPctNA(r.affoPayout) },
    ];
  }
  if (arch === "E" && isAssetLightStatement(latest)) {
    const r = computeAssetLightRatios(latest, cmp);
    return [
      { label: "Op Margin", value: fmtPctNA(r.operatingMargin) },
      { label: "Fee/AUM", value: r.revenueAsPctOfAum > 0 ? fmtPctNA(r.revenueAsPctOfAum) : "N/M" },
      { label: "FCF Conv", value: `${Math.round(r.fcfConversion * 100)}%` },
      { label: "ROE", value: fmtPctNA(r.roe) },
    ];
  }
  return [];
}
