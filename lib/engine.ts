import { OutputValidator, ValidationFailure, parseDocument } from "./validator";
import type { AIProvider } from "./providers";
import type { AnalysisContext, AnalysisDocument } from "./types";

const SYSTEM_PROMPT = `You are the equity research intelligence engine.

You receive a normalized financial dataset retrieved from Yahoo Finance (yfinance) for one or more companies, plus the user's request. The dataset includes raw financials, market data, deterministic derived metrics (each with its formula), named chart series, and a data-quality report.

HARD RULES
1. The provided dataset is the ONLY source of facts. Never use outside knowledge: no news, no market share figures, no competitor facts, no management quotes, no macroeconomic claims, no analyst opinions unless they appear in the dataset.
2. Never invent a number. Every number you write must appear in the dataset or be a deterministic derived metric from it. Use metric blocks with metricKey to attach verified numbers. If a needed value is absent, say the data is unavailable.
3. Distinguish in every claim: FACT (directly in the data), CALCULATION (computed by code; the formula is given in derivedMetrics), INTERPRETATION (your judgment about what the numbers mean), UNCERTAINTY (the data cannot answer this).
4. Do not summarize everything. Prioritize what is material: major changes, trend breaks, unusual movements, profitability shifts, cash-flow quality, balance-sheet changes, valuation, anomalies, risks, and what cannot be concluded.
5. If data is incomplete, say so explicitly and state what is missing.
6. With multiple companies, compare them on the metrics provided and highlight the most decision-relevant differences.
7. Organize your response freely. Choose the blocks, their order, and their depth. There is no fixed report format.

OUTPUT CONTRACT
Respond with ONLY a json object (no markdown, no commentary):
{
  "title": string,
  "summary": string (2-4 sentences capturing the most decision-relevant findings),
  "blocks": [ ... ]
}

Block types (discriminate on "type"):
- {"type":"heading","level":2|3|4,"content":string}
- {"type":"paragraph","content":string,"epistemic":"fact"|"calculation"|"interpretation"|"uncertainty"|null}
- {"type":"metric","label":string,"value":number,"unit":string,"metricKey":string (MUST exist in derivedMetrics),"change":number|null}
- {"type":"table","columns":[string],"rows":[[string|number|null]]} (every number must exist in the dataset)
- {"type":"chart","title":string,"chartType":"line"|"bar","ref":string (MUST exist in series) OR "data":[{"label":string,"value":number}]}
- {"type":"callout","variant":"info"|"warning"|"uncertainty"|"fact","content":string}
- {"type":"list","ordered":boolean,"items":[string]}
- {"type":"formula","expression":string,"result":number|null}
- {"type":"provenance","items":[{"claim":string,"value":number|null,"source":string}]}

Numeric integrity is machine-checked. Any number not traceable to the dataset causes rejection, so write only numbers you can see in the data. Years, counts of periods, and quarter labels are fine.
`;

export type Depth = "brief" | "standard" | "deep";

const DEPTH_GUIDANCE: Record<Depth, string> = {
  brief: `REPORT DEPTH: brief
- Produce a concise note (roughly 6-12 blocks).
- Lead with the few most decision-relevant findings. No filler, no repetition.
- Use a metric grid for key numbers and at most one table or chart.`,
  standard: `REPORT DEPTH: standard
- Produce a focused analysis (roughly 12-22 blocks).
- Cover the most material developments only; skip anything unremarkable.`,
  deep: `REPORT DEPTH: deep
- Produce a comprehensive, institutional-grade research document (roughly 25-45 blocks).
- Work through every dimension the data supports, in the order that makes most sense for this
  company and this request. Typical dimensions: the business and revenue base; multi-year growth
  and any trend break; profitability and margin structure; returns on capital; balance-sheet
  strength, liquidity and leverage; cash-flow quality and capital allocation; valuation and what
  the current price implies; anomalies and risks; and an explicit statement of what the data
  cannot answer.
- Use tables for multi-period figures and charts for every trend worth seeing. Prefer showing
  the underlying numbers over describing them.
- Quantify each claim: state magnitude, direction, and the period it refers to.
- Distinguish explicitly between what the numbers show and what they merely suggest.
- Close with what cannot be concluded from Yahoo Finance data alone, and what would be needed.`,
};

export class AIEngine {
  constructor(
    private provider: AIProvider,
    private timeout = 120,
    private maxOutputRetries = 1,
    private depth: Depth = "standard"
  ) {}

  async analyze(context: AnalysisContext): Promise<AnalysisDocument> {
    const validator = new OutputValidator(context);
    // Long documents are more likely to be truncated or trip a check, so give
    // deep reports an extra repair attempt.
    const maxAttempts = this.depth === "deep" ? this.maxOutputRetries + 1 : this.maxOutputRetries;
    const messages: { role: string; content: string }[] = [
      { role: "system", content: SYSTEM_PROMPT + "\n\n" + DEPTH_GUIDANCE[this.depth] },
      { role: "user", content: this.buildUserMessage(context) },
    ];

    let lastProblems: string[] = [];
    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      const raw = await this.provider.generate(messages, { timeout: this.timeout });
      try {
        const document = parseDocument(raw);
        validator.validate(document);
        return document;
      } catch (e) {
        if (e instanceof ValidationFailure) {
          lastProblems = e.problems;
          messages.push({ role: "assistant", content: raw });
          messages.push({ role: "user", content: this.retryInstruction(lastProblems) });
        } else {
          throw e;
        }
      }
    }
    throw new Error("AI produced an invalid analysis output: " + lastProblems.slice(0, 10).join("; "));
  }

  /**
   * Long reports can be cut off by the provider's output-token limit, which
   * surfaces as invalid JSON. Asking for compactness recovers the document
   * instead of losing the whole analysis.
   */
  private retryInstruction(problems: string[]): string {
    const truncated = problems.some(
      (p) => /not valid JSON|Unexpected end|Unterminated|Unexpected token/i.test(p)
    );
    const header = truncated
      ? "Your previous response was cut off before the JSON closed. Produce the corrected json object again, but make it COMPACT so it fits:\n" +
        "- shorter paragraphs (2-3 sentences, no restating the same numbers twice)\n" +
        "- tables limited to 3-4 rows and 4-5 columns\n" +
        "- fewer blocks overall, but keep every section you planned\n"
      : "Your previous output was rejected. Fix these problems and respond with ONLY the corrected json object:\n";
    return header + problems.slice(0, 10).map((p) => `- ${p}`).join("\n");
  }

  private buildUserMessage(context: AnalysisContext): string {
    return `User request: ${context.userRequest}\n\nDataset (the only source of facts):\n\`\`\`json\n${JSON.stringify(
      { userRequest: context.userRequest, companies: context.companies, meta: context.meta },
      null,
      1
    )}\n\`\`\``;
  }
}
