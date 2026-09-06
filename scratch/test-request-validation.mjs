import assert from "node:assert/strict";
import { normalizeSearchQuery, normalizeTicker } from "../src/lib/request-validation.ts";

assert.equal(normalizeTicker(" brk-b "), "BRK-B");
assert.equal(normalizeTicker("^gspc"), "^GSPC");
assert.equal(normalizeTicker("0700.hk"), "0700.HK");
assert.equal(normalizeTicker("AAPL&modules=price"), null);
assert.equal(normalizeTicker("AAPL/../../etc"), null);
assert.equal(normalizeTicker("AAPL\nX"), null);
assert.equal(normalizeSearchQuery(" Reliance Industries "), "Reliance Industries");
assert.equal(normalizeSearchQuery("\u0000AAPL"), "AAPL");
assert.equal(normalizeSearchQuery("x".repeat(81)), null);
console.log("Request-validation tests passed");
