export interface EvalError { ok: false; error: string; }
export interface EvalOk { ok: true; value: number; }

export type ExpressionNode =
  | { kind: "number"; value: number }
  | { kind: "identifier"; name: string }
  | { kind: "unary"; operator: "+" | "-"; operand: ExpressionNode }
  | { kind: "binary"; operator: "+" | "-" | "*" | "/"; left: ExpressionNode; right: ExpressionNode };

export interface ParsedExpression {
  ok: true;
  ast: ExpressionNode;
  variables: string[];
  normalized: string;
}

export interface ExpressionParseError {
  ok: false;
  error: string;
}

type Token =
  | { type: "number"; value: number; text: string }
  | { type: "identifier"; value: string }
  | { type: "operator"; value: "+" | "-" | "*" | "/" }
  | { type: "leftParen" }
  | { type: "rightParen" };

const IDENTIFIER_START = /[A-Za-z_]/;
const IDENTIFIER_PART = /[A-Za-z0-9_]/;

function tokenize(expression: string): { tokens: Token[]; error?: string } {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const character = expression[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "(") {
      tokens.push({ type: "leftParen" });
      index += 1;
      continue;
    }
    if (character === ")") {
      tokens.push({ type: "rightParen" });
      index += 1;
      continue;
    }
    if (character === "+" || character === "-" || character === "*" || character === "/") {
      tokens.push({ type: "operator", value: character });
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(character)) {
      const remaining = expression.slice(index);
      const match = remaining.match(/^(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?/);
      if (!match || match[0].length === 0) return { tokens, error: `Invalid number at position ${index}` };
      const value = Number(match[0]);
      if (!Number.isFinite(value)) return { tokens, error: `Invalid number at position ${index}` };
      tokens.push({ type: "number", value, text: match[0] });
      index += match[0].length;
      continue;
    }
    if (IDENTIFIER_START.test(character)) {
      let end = index + 1;
      while (end < expression.length && IDENTIFIER_PART.test(expression[end])) end += 1;
      tokens.push({ type: "identifier", value: expression.slice(index, end) });
      index = end;
      continue;
    }
    return { tokens, error: `Disallowed character: ${character}` };
  }
  return { tokens };
}

class Parser {
  private position = 0;

  public constructor(private readonly tokens: readonly Token[]) {}

  public parse(): ExpressionNode | string {
    if (this.tokens.length === 0) return "Empty expression";
    const expression = this.parseExpression();
    if (typeof expression === "string") return expression;
    if (this.peek() !== undefined) return "Trailing tokens after expression end";
    return expression;
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private take(): Token | undefined {
    const token = this.peek();
    if (token) this.position += 1;
    return token;
  }

  private parseExpression(): ExpressionNode | string {
    let left = this.parseTerm();
    if (typeof left === "string") return left;
    while (this.peek()?.type === "operator" && (this.peek() as Extract<Token, { type: "operator" }>).value !== "*" && (this.peek() as Extract<Token, { type: "operator" }>).value !== "/") {
      const operator = (this.take() as Extract<Token, { type: "operator" }>).value;
      const right = this.parseTerm();
      if (typeof right === "string") return right;
      left = { kind: "binary", operator, left, right };
    }
    return left;
  }

  private parseTerm(): ExpressionNode | string {
    let left = this.parseFactor();
    if (typeof left === "string") return left;
    while (this.peek()?.type === "operator" && ((this.peek() as Extract<Token, { type: "operator" }>).value === "*" || (this.peek() as Extract<Token, { type: "operator" }>).value === "/")) {
      const operator = (this.take() as Extract<Token, { type: "operator" }>).value;
      const right = this.parseFactor();
      if (typeof right === "string") return right;
      left = { kind: "binary", operator, left, right };
    }
    return left;
  }

  private parseFactor(): ExpressionNode | string {
    const token = this.take();
    if (!token) return "Unexpected end of expression";
    if (token.type === "number") return { kind: "number", value: token.value };
    if (token.type === "identifier") return { kind: "identifier", name: token.value };
    if (token.type === "operator" && (token.value === "+" || token.value === "-")) {
      const operand = this.parseFactor();
      if (typeof operand === "string") return operand;
      return { kind: "unary", operator: token.value, operand };
    }
    if (token.type === "leftParen") {
      const expression = this.parseExpression();
      if (typeof expression === "string") return expression;
      if (this.take()?.type !== "rightParen") return "Missing closing parenthesis";
      return expression;
    }
    return "Unexpected token in expression";
  }
}

function collectVariables(node: ExpressionNode, output: string[]): void {
  if (node.kind === "identifier") {
    if (!output.includes(node.name)) output.push(node.name);
    return;
  }
  if (node.kind === "unary") {
    collectVariables(node.operand, output);
    return;
  }
  if (node.kind !== "binary") return;
  collectVariables(node.left, output);
  collectVariables(node.right, output);
}

function renderNode(node: ExpressionNode): string {
  if (node.kind === "number") return String(node.value);
  if (node.kind === "identifier") return node.name;
  if (node.kind === "unary") return `${node.operator}${renderNode(node.operand)}`;
  return `(${renderNode(node.left)} ${node.operator} ${renderNode(node.right)})`;
}

export function parseExpression(expression: string): ParsedExpression | ExpressionParseError {
  if (typeof expression !== "string" || expression.trim().length === 0) return { ok: false, error: "Empty expression" };
  const tokenized = tokenize(expression);
  if (tokenized.error) return { ok: false, error: tokenized.error };
  const parser = new Parser(tokenized.tokens);
  const ast = parser.parse();
  if (typeof ast === "string") return { ok: false, error: ast };
  const variables: string[] = [];
  collectVariables(ast, variables);
  return { ok: true, ast, variables, normalized: renderNode(ast) };
}

function evaluateNode(node: ExpressionNode, environment: Readonly<Record<string, number>>, canonicalNames: ReadonlyMap<string, string>): number | string {
  if (node.kind === "number") return node.value;
  if (node.kind === "identifier") {
    const canonical = canonicalNames.get(node.name.toLowerCase());
    if (!canonical) return `Unknown variable: ${node.name}`;
    const value = environment[canonical];
    if (typeof value !== "number" || !Number.isFinite(value)) return `Unavailable variable: ${node.name}`;
    return value;
  }
  if (node.kind === "unary") {
    const operand = evaluateNode(node.operand, environment, canonicalNames);
    if (typeof operand === "string") return operand;
    const result = node.operator === "-" ? -operand : operand;
    return Number.isFinite(result) ? result : "Expression did not evaluate to a finite number";
  }
  if (node.kind !== "binary") return "Invalid expression node";
  const left = evaluateNode(node.left, environment, canonicalNames);
  if (typeof left === "string") return left;
  const right = evaluateNode(node.right, environment, canonicalNames);
  if (typeof right === "string") return right;
  let result: number;
  if (node.operator === "+") result = left + right;
  else if (node.operator === "-") result = left - right;
  else if (node.operator === "*") result = left * right;
  else {
    if (right === 0) return "Division by zero";
    result = left / right;
  }
  return Number.isFinite(result) ? result : "Expression did not evaluate to a finite number";
}

export function evalExpression(expr: string, env: Record<string, number>): EvalOk | EvalError {
  const parsed = parseExpression(expr);
  if (!parsed.ok) return parsed;
  const canonicalNames = new Map<string, string>();
  for (const name of Object.keys(env)) canonicalNames.set(name.toLowerCase(), name);
  const result = evaluateNode(parsed.ast, env, canonicalNames);
  if (typeof result === "string") return { ok: false, error: result };
  return { ok: true, value: result };
}

export function expressionVariables(expression: string): string[] {
  const parsed = parseExpression(expression);
  return parsed.ok ? [...parsed.variables] : [];
}

export function validateExpressionGrammar(expression: string): { valid: boolean; error?: string; variables: string[] } {
  const parsed = parseExpression(expression);
  return parsed.ok ? { valid: true, variables: [...parsed.variables] } : { valid: false, error: parsed.error, variables: [] };
}

export function applyGrowthPath(base: number, growthRates: number[]): number[] {
  if (typeof base !== "number" || !Number.isFinite(base)) throw new TypeError("Growth-path base must be a finite number");
  if (!Array.isArray(growthRates)) throw new TypeError("Growth path must be an array");
  let current = base;
  return growthRates.map((growthRate) => {
    if (typeof growthRate !== "number" || !Number.isFinite(growthRate)) throw new TypeError("Growth-path rates must be finite numbers");
    if (growthRate <= -1) throw new RangeError("Growth-path rates must be greater than -1");
    current *= 1 + growthRate;
    if (!Number.isFinite(current)) throw new RangeError("Growth path produced a non-finite value");
    return current;
  });
}

export default { evalExpression, applyGrowthPath, parseExpression, expressionVariables, validateExpressionGrammar };
