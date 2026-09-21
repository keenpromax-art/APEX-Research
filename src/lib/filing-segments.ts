/**
 * APEX RESEARCH — PRIMARY Filing Segment Registry (SOTP input layer)
 * --------------------------------------------------------------------
 * Yahoo/secondary feeds carry no segment split, so a conglomerate SOTP
 * cannot be built from the ingestion layer alone. This registry holds
 * filing-disclosed segment financials (PRIMARY tier) keyed by ticker.
 * Every figure cites its source document + period; NOTHING here is
 * estimated. Companies absent from the registry get no SOTP
 * (status "insufficient_data") — a missing SOTP is disclosed, never
 * synthesized from the consolidated total.
 *
 * Units: absolute currency units (₹ crore × 1e7). Currency per entry.
 */

export interface FilingSegment {
  /** Segment name in the company's own vocabulary. */
  name: string;
  /** Filing-disclosed segment EBITDA (absolute currency units). */
  ebitda: number;
  /** Filing-disclosed segment revenue, when published (absolute units). */
  revenue?: number;
  /** Source document, e.g. "RIL Integrated Annual Report 2024-25". */
  sourceDoc: string;
  /** Period the figures cover, e.g. "FY2025". */
  period: string;
  /** Source URL when available. */
  sourceUrl?: string;
}

export interface FilingSegmentSet {
  /** Canonical ticker, e.g. "RELIANCE.NS". */
  ticker: string;
  /** Additional ticker spellings that resolve to this set. */
  aliases: string[];
  currency: string;
  period: string;
  /** Filing-disclosed consolidated EBITDA (coverage-check denominator). */
  consolidatedEbitda: number;
  consolidatedRevenue?: number;
  segments: FilingSegment[];
}

const CRORE = 1e7;

const REGISTRY: FilingSegmentSet[] = [
  {
    ticker: "RELIANCE.NS",
    aliases: ["RELIANCE.BO", "RIL", "RELIANCE"],
    currency: "INR",
    period: "FY2025",
    consolidatedEbitda: 183422 * CRORE,
    consolidatedRevenue: 1071174 * CRORE,
    segments: [
      {
        name: "Oil to Chemicals (O2C)",
        ebitda: 54988 * CRORE,
        revenue: 626921 * CRORE,
        sourceDoc: "RIL Integrated Annual Report 2024-25 — Reliance at a Glance",
        period: "FY2025",
        sourceUrl: "https://www.ril.com/ar2024-25/reliance-at-a-glance.html",
      },
      {
        name: "Digital Services (Jio Platforms)",
        ebitda: 65001 * CRORE,
        revenue: 131336 * CRORE,
        sourceDoc: "RIL Annual Report 2024-25 disclosures (FY25 results)",
        period: "FY2025",
      },
      {
        name: "Retail (RRVL)",
        ebitda: 25053 * CRORE,
        revenue: 330870 * CRORE,
        sourceDoc: "RIL FY25 consolidated media release, 25-Apr-2025",
        period: "FY2025",
        sourceUrl: "https://www.ril.com/sites/default/files/2025-04/SE_Media_release.pdf",
      },
      {
        name: "Oil and Gas (E&P)",
        ebitda: 21188 * CRORE,
        revenue: 25211 * CRORE,
        sourceDoc: "RIL Integrated Annual Report 2024-25 — Reliance at a Glance",
        period: "FY2025",
        sourceUrl: "https://www.ril.com/ar2024-25/reliance-at-a-glance.html",
      },
    ],
  },
];

function normalizeTicker(t: string): string {
  return (t || "").toUpperCase().replace(/\.(NS|BO)$/, "");
}

/** PRIMARY segment set for a ticker, or null when no filing data is held. */
export function getFilingSegments(ticker: string): FilingSegmentSet | null {
  const n = normalizeTicker(ticker);
  for (const set of REGISTRY) {
    if (normalizeTicker(set.ticker) === n) return set;
    if (set.aliases.some((a) => normalizeTicker(a) === n)) return set;
  }
  return null;
}
