/**
 * APEX RESEARCH — LLM JSON salvage
 * -------------------------------
 * A length-truncated LLM response is not a failed response: every field that
 * was fully written before the cutoff is valid, evidence-grounded content.
 * Discarding the whole draft (the previous behaviour) is the single largest
 * cause of thin, bland reports — the model produced 2,000 words and the
 * pipeline threw all of it away because the closing brace was missing.
 *
 * This module recovers complete top-level fields from a truncated object.
 * It NEVER invents, completes, or reorders values: only byte-for-byte
 * complete `"key": <value>` pairs present in the response are returned.
 * The caller merges the result with its own fallback shape.
 */

/** Strip markdown fences without touching content. */
function stripFences(raw: string): string {
  return raw.replace(/```json/gi, "").replace(/```/g, "").trim();
}

/** Index just past the end of the JSON value starting at `start`. */
function scanValue(text: string, start: number): number {
  let i = start;
  // Skip whitespace
  while (i < text.length && /\s/.test(text[i])) i++;
  if (i >= text.length) return -1;
  const ch = text[i];

  if (ch === '"') {
    i++;
    while (i < text.length) {
      if (text[i] === "\\") {
        i += 2;
        continue;
      }
      if (text[i] === '"') return i + 1;
      i++;
    }
    return -1;
  }

  if (ch === "{" || ch === "[") {
    const open = ch;
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    for (; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (c === "\\") {
          i++;
          continue;
        }
        if (c === '"') inString = false;
        continue;
      }
      if (c === '"') {
        inString = true;
        continue;
      }
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
    return -1;
  }

  // Primitive: number / true / false / null
  let j = i;
  while (j < text.length && !/[,}\]\s]/.test(text[j])) j++;
  return j > i ? j : -1;
}

/** Parse a top-level key name starting at `start` (assumes `"`). */
function scanKey(text: string, start: number): { key: string; next: number } | null {
  if (text[start] !== '"') return null;
  let i = start + 1;
  let key = "";
  while (i < text.length) {
    if (text[i] === "\\") {
      key += text[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (text[i] === '"') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] !== ":") return null;
      return { key, next: j + 1 };
    }
    key += text[i];
    i++;
  }
  return null;
}

/**
 * Recover every COMPLETE top-level field from a possibly-truncated JSON object.
 * Returns `{}` when the object itself is too damaged to salvage anything.
 */
export function salvageTruncatedJsonObject(raw: string): Record<string, unknown> {
  const text = stripFences(raw);
  const open = text.indexOf("{");
  if (open === -1) return {};

  const out: Record<string, unknown> = {};
  let i = open + 1;
  let guard = 0;

  while (i < text.length && guard++ < 1000) {
    while (i < text.length && /[\s,]/.test(text[i])) i++;
    if (i >= text.length) break;
    if (text[i] === "}") break; // clean end
    if (text[i] !== '"') break; // unexpected structure — stop, keep what we have

    const parsedKey = scanKey(text, i);
    if (!parsedKey) break;
    const valueEnd = scanValue(text, parsedKey.next);
    if (valueEnd === -1) break; // value incomplete → truncation point reached

    const valueText = text.slice(parsedKey.next, valueEnd);
    try {
      out[parsedKey.key] = JSON.parse(valueText);
    } catch {
      // Unparseable single value — keep scanning; do not discard earlier fields.
    }
    i = valueEnd;
  }

  return out;
}

/**
 * Salvage a top-level array of complete elements from a truncated array.
 */
export function salvageTruncatedJsonArray(raw: string): unknown[] {
  const text = stripFences(raw);
  const open = text.indexOf("[");
  if (open === -1) return [];
  const out: unknown[] = [];
  let i = open + 1;
  let guard = 0;
  while (i < text.length && guard++ < 1000) {
    while (i < text.length && /[\s,]/.test(text[i])) i++;
    if (i >= text.length || text[i] === "]") break;
    const end = scanValue(text, i);
    if (end === -1) break;
    try {
      out.push(JSON.parse(text.slice(i, end)));
    } catch {
      break;
    }
    i = end;
  }
  return out;
}

/**
 * Merge a fresh complete parse over the salvage shape, then layer the
 * caller's fallback underneath so missing fields keep their safe default.
 * Arrays: salvage wins when it recovered at least one element.
 */
export function mergeSalvaged<T extends Record<string, unknown>>(
  salvaged: Record<string, unknown>,
  fallback: T
): T {
  const merged: Record<string, unknown> = { ...fallback };
  for (const [key, value] of Object.entries(salvaged)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) merged[key] = value;
      continue;
    }
    if (value === null || value === "") continue;
    merged[key] = value;
  }
  return merged as T;
}
