import { describe, expect, it } from "vitest";
import { parseTickers } from "./pipeline";

describe("parseTickers", () => {
  it("parses single and multiple tickers", () => {
    expect(parseTickers("AAPL")).toEqual(["AAPL"]);
    expect(parseTickers("aapl, msft")).toEqual(["AAPL", "MSFT"]);
    expect(parseTickers("RELIANCE.NS NVDA")).toEqual(["RELIANCE.NS", "NVDA"]);
  });

  it("dedupes tickers", () => {
    expect(parseTickers("AAPL, aapl")).toEqual(["AAPL"]);
  });

  it("rejects invalid formats", () => {
    expect(() => parseTickers("!!!bad!!!")).toThrow("Invalid ticker format");
  });

  it("rejects empty input", () => {
    expect(() => parseTickers("")).toThrow("Enter at least one ticker");
  });

  it("rejects more than five tickers", () => {
    expect(() => parseTickers("A,B,C,D,E,F")).toThrow("Maximum 5 tickers");
  });
});
