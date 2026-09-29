import { AIEngine } from "./engine";
import { buildProvider, type ProviderName } from "./providers";
import { buildContext } from "./context";
import { calculate } from "./calculator";
import { normalize } from "./normalizer";
import type { AnalysisDocument, Block, RawTickerData } from "./types";

export interface PipelineResult {
  title: string;
  summary: string;
  blocks: Block[];
  meta: { generatedAt: string; tickers: string[]; dataSource: string };
}

const TICKER_RE = /^[A-Za-z0-9.\-^=]{1,25}$/;
const MAX_TICKERS = 5;

export function parseTickers(raw: string): string[] {
  const tickers: string[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    const ticker = part.trim().toUpperCase();
    if (!ticker) continue;
    if (!TICKER_RE.test(ticker)) throw new Error(`Invalid ticker format: '${part}'.`);
    if (!tickers.includes(ticker)) tickers.push(ticker);
  }
  if (tickers.length === 0) throw new Error("Enter at least one ticker.");
  if (tickers.length > MAX_TICKERS) throw new Error(`Maximum ${MAX_TICKERS} tickers per analysis.`);
  return tickers;
}

export interface PipelineOptions {
  fetchFn?: (ticker: string) => Promise<RawTickerData>;
  providerName?: ProviderName | null;
  apiKey?: string | null;
  model?: string | null;
  aiTimeout?: number;
}

export class AnalysisPipeline {
  constructor(private options: PipelineOptions = {}) {}

  async run(tickers: string[], userRequest: string, status: (s: string) => void): Promise<PipelineResult> {
    status("Fetching data...");
    const raw = await Promise.all(tickers.map((t) => this.fetch(t)));

    status("Preparing financial context...");
    const financials = raw.map(normalize);
    const derived = financials.map(calculate);
    const context = buildContext(financials, derived, userRequest);

    status("AI analyzing...");
    const provider = this.resolveProvider();
    if (!provider) throw new Error("AI provider is not configured. Set an AI provider key in the UI or environment.");
    const engine = new AIEngine(provider, this.options.aiTimeout ?? 120);
    const document = await engine.analyze(context);

    status("Rendering analysis...");
    const blocks = this.resolveCharts(document, context);
    return {
      title: document.title,
      summary: document.summary,
      blocks: blocks.map((b) => b as Block),
      meta: context.meta,
    };
  }

  private async fetch(ticker: string): Promise<RawTickerData> {
    if (this.options.fetchFn) return this.options.fetchFn(ticker);
    const resp = await fetch(`/api/fetch/${encodeURIComponent(ticker)}`);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `Unable to retrieve data for '${ticker}'.`);
    return data as RawTickerData;
  }

  private resolveProvider() {
    const name = this.options.providerName;
    const key = this.options.apiKey;
    const model = this.options.model;
    if (name && key) return buildProvider(name, key, model ?? null);
    if (!name || !key) {
      const envName = (process.env.AI_PROVIDER as ProviderName) ?? "gemini";
      const envKey = process.env[`${envName.toUpperCase()}_API_KEY`] ?? null;
      const envModel = process.env[`${envName.toUpperCase()}_MODEL`] ?? null;
      if (!envKey) return null;
      return buildProvider(envName, envKey, envModel);
    }
    return null;
  }

  private resolveCharts(document: AnalysisDocument, context: ReturnType<typeof buildContext>): Block[] {
    const seriesIndex = new Map<string, { label: string; value: number }[]>();
    for (const company of context.companies) {
      for (const [name, points] of Object.entries(company.series)) {
        if (!seriesIndex.has(name)) seriesIndex.set(name, points);
      }
    }
    return document.blocks.map((block) => {
      if (block.type === "chart" && block.ref) {
        return { ...block, data: seriesIndex.get(block.ref) ?? [], ref: null };
      }
      return block;
    });
  }
}
