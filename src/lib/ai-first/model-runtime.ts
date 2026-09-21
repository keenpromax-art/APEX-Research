/**
 * APEX RESEARCH — DETERMINISTIC MODEL RUNTIME
 *
 * "AI decides the model. Code executes the model."
 *
 * Executes AI-generated formulas over forecast variables with safe arithmetic.
 * The LLM NEVER performs arithmetic — it produces Formula specifications
 * ({ expression: "volume * asp" }) and this runtime computes them.
 */

export interface EvalError { ok: false; error: string; }
export interface EvalOk { ok: true; value: number; }

/**
 * Evaluate a math expression string over a variable environment.
 * Supports + - * / ( ), unary minus, numeric literals, and variables in `env`.
 * Whitelisted tokens only — no arbitrary code execution.
 */
export function evalExpression(expr: string, env: Record<string, number>): EvalOk | EvalError {
  if (!expr || !expr.trim()) return { ok: false, error: "Empty expression" };

  // Tokenize
  const tokens: Array<{ t: "num" | "id" | "op" | "lparen" | "rparen"; v: string }> = [];
  const s = expr.replace(/\s+/g, "");
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      tokens.push({ t: "num", v: s.slice(i, j) });
      i = j;
    } else if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j++;
      tokens.push({ t: "id", v: s.slice(i, j).toLowerCase() });
      i = j;
    } else if ("+-*/".includes(c)) {
      tokens.push({ t: "op", v: c });
      i++;
    } else if (c === "(") {
      tokens.push({ t: "lparen", v: c });
      i++;
    } else if (c === ")") {
      tokens.push({ t: "rparen", v: c });
      i++;
    } else {
      return { ok: false, error: `Disallowed character: ${c}` };
    }
  }

  // Validate identifiers against env (case-insensitive)
  const envKeys = new Set(Object.keys(env).map((k) => k.toLowerCase()));
  for (const tok of tokens) {
    if (tok.t === "id" && !envKeys.has(tok.v)) {
      return { ok: false, error: `Unknown variable: ${tok.v}` };
    }
  }

  // Resolve id tokens to their canonical env key casing
  const canonical = new Map<string, string>();
  for (const k of Object.keys(env)) canonical.set(k.toLowerCase(), k);

  // Recursive-descent parse + eval
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr(): number | null {
    let val = parseTerm();
    while (peek() && peek()!.t === "op" && "+-".includes(peek()!.v)) {
      const op = next().v;
      const rhs = parseTerm();
      if (val === null || rhs === null) return null;
      val = op === "+" ? val + rhs : val - rhs;
    }
    return val;
  }

  function parseTerm(): number | null {
    let val = parseFactor();
    while (peek() && peek()!.t === "op" && "*/".includes(peek()!.v)) {
      const op = next().v;
      const rhs = parseFactor();
      if (val === null || rhs === null) return null;
      val = op === "*" ? val * rhs : val / rhs;
      if (!isFinite(val)) return null;
    }
    return val;
  }

  function parseFactor(): number | null {
    const tok = next();
    if (!tok) return null;
    if (tok.t === "num") return parseFloat(tok.v);
    if (tok.t === "id") return env[canonical.get(tok.v)!];
    if (tok.t === "op" && (tok.v === "-" || tok.v === "+")) {
      const inner = parseFactor();
      if (inner === null) return null;
      return tok.v === "-" ? -inner : inner;
    }
    if (tok.t === "lparen") {
      const inner = parseExpr();
      if (peek() && peek()!.t === "rparen") next();
      return inner;
    }
    return null;
  }

  const result = parseExpr();
  if (result === null || !isFinite(result)) {
    return { ok: false, error: "Expression did not evaluate to a finite number" };
  }
  if (pos !== tokens.length) {
    return { ok: false, error: "Trailing tokens after expression end" };
  }
  return { ok: true, value: result };
}

/** Apply an annual growth path to a base value: [base * (1+g1), * (1+g1)(1+g2), ...] */
export function applyGrowthPath(base: number, growthRates: number[]): number[] {
  const out: number[] = [];
  let cur = base;
  for (const g of growthRates) {
    cur = cur * (1 + (isFinite(g) ? g : 0));
    out.push(cur);
  }
  return out;
}
