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

export class AIEngine {
  constructor(
    private provider: AIProvider,
    private timeout = 120,
    private maxOutputRetries = 1
  ) {}

  async analyze(context: AnalysisContext): Promise<AnalysisDocument> {
    const validator = new OutputValidator(context);
    const messages: { role: string; content: string }[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: this.buildUserMessage(context) },
    ];

    let lastProblems: string[] = [];
    for (let attempt = 0; attempt <= this.maxOutputRetries; attempt++) {
      const raw = await this.provider.generate(messages, { timeout: this.timeout });
      try {
        const document = parseDocument(raw);
        validator.validate(document);
        return document;
      } catch (e) {
        if (e instanceof ValidationFailure) {
          lastProblems = e.problems;
          messages.push({ role: "assistant", content: raw });
          messages.push({
            role: "user",
            content:
              "Your previous output was rejected. Fix these problems and respond with ONLY the corrected json object:\n" +
              lastProblems.slice(0, 10).map((p) => `- ${p}`).join("\n"),
          });
        } else {
          throw e;
        }
      }
    }
    throw new Error("AI produced an invalid analysis output: " + lastProblems.slice(0, 10).join("; "));
  }

  private buildUserMessage(context: AnalysisContext): string {
    return `User request: ${context.userRequest}\n\nDataset (the only source of facts):\n\`\`\`json\n${JSON.stringify(
      { userRequest: context.userRequest, companies: context.companies, meta: context.meta },
      null,
      1
    )}\n\`\`\``;
  }
}
