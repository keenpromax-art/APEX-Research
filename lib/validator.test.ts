import { describe, expect, it } from "vitest";
import { buildContext } from "./context";
import { calculate } from "./calculator";
import { normalize } from "./normalizer";
import { OutputValidator, parseDocument, ValidationFailure } from "./validator";
import { makeRawData } from "./testUtils";

const context = () => {
  const data = normalize(makeRawData());
  return buildContext([data], [calculate(data)], "Analyze this company.");
};

const validDocument = () => {
  const ctx = context();
  const growth = ctx.companies[0].derivedMetrics["revenue_growth"].value;
  return JSON.stringify({
    title: "Test Analysis",
    summary: "Revenue was 1000 last year.",
    blocks: [
      { type: "heading", level: 2, content: "Overview" },
      { type: "paragraph", content: "Revenue grew to 1000 from 900." },
      { type: "metric", label: "Revenue growth", value: growth, unit: "percent", metricKey: "revenue_growth" },
      { type: "table", columns: ["Item", "FY2025"], rows: [["Revenue", 1000]] },
      { type: "callout", variant: "info", content: "Data as of 2026." },
      { type: "list", ordered: false, items: ["First point about 150"] },
      { type: "formula", expression: "1000 / 900 - 1", result: 0.1111111111111111 },
      { type: "provenance", items: [{ claim: "Revenue increased", value: 1000, source: "yfinance" }] },
      { type: "chart", title: "Price", chartType: "line", ref: "price" },
    ],
  });
};

describe("validator", () => {
  it("accepts a valid document", () => {
    const doc = parseDocument(validDocument());
    new OutputValidator(context()).validate(doc);
  });

  it("rejects hallucinated numbers in paragraphs", () => {
    const doc = parseDocument(JSON.stringify({
      title: "T",
      summary: "S",
      blocks: [{ type: "paragraph", content: "Revenue grew to 999999 last year." }],
    }));
    expect(() => new OutputValidator(context()).validate(doc)).toThrow(ValidationFailure);
  });

  it("rejects hallucinated numbers in tables", () => {
    const doc = parseDocument(JSON.stringify({
      title: "T",
      summary: "S",
      blocks: [{ type: "table", columns: ["A"], rows: [[12345678]] }],
    }));
    expect(() => new OutputValidator(context()).validate(doc)).toThrow(ValidationFailure);
  });

  it("rejects unknown metric keys", () => {
    const doc = parseDocument(JSON.stringify({
      title: "T",
      summary: "S",
      blocks: [{ type: "metric", label: "X", value: 1, metricKey: "not_a_metric" }],
    }));
    expect(() => new OutputValidator(context()).validate(doc)).toThrow(ValidationFailure);
  });

  it("rejects metric value mismatches", () => {
    const doc = parseDocument(JSON.stringify({
      title: "T",
      summary: "S",
      blocks: [{ type: "metric", label: "X", value: 0.5, metricKey: "revenue_growth" }],
    }));
    expect(() => new OutputValidator(context()).validate(doc)).toThrow(ValidationFailure);
  });

  it("rejects unknown chart refs", () => {
    const doc = parseDocument(JSON.stringify({
      title: "T",
      summary: "S",
      blocks: [{ type: "chart", title: "X", ref: "not_a_series" }],
    }));
    expect(() => new OutputValidator(context()).validate(doc)).toThrow(ValidationFailure);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseDocument("not json at all")).toThrow(ValidationFailure);
  });

  it("rejects schema violations", () => {
    expect(() => parseDocument('{"title":"T","summary":"S","blocks":[{"type":"unknown"}]}')).toThrow(ValidationFailure);
  });

  it("allows years, small counts and quarter labels", () => {
    const doc = parseDocument(JSON.stringify({
      title: "T",
      summary: "S",
      blocks: [{ type: "paragraph", content: "In 2024 there were 3 segments and 12 months. Q3 was strong." }],
    }));
    new OutputValidator(context()).validate(doc);
  });

  it("accepts formatted variants of known values", () => {
    const doc = parseDocument(JSON.stringify({
      title: "T",
      summary: "S",
      blocks: [{ type: "paragraph", content: "Revenue was 1,000 or 1000.0 or 10.0% or 10.0x." }],
    }));
    new OutputValidator(context()).validate(doc);
  });

  it("accepts percentages of known ratios", () => {
    const doc = parseDocument(JSON.stringify({
      title: "T",
      summary: "S",
      blocks: [{ type: "paragraph", content: "Gross margin was 40%." }],
    }));
    new OutputValidator(context()).validate(doc);
  });
});
