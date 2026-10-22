import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

// Runs the Next.js dev server together with the local yfinance data server,
// so `npm run dev` serves real data instead of 404ing on /api/fetch/<TICKER>.

const PYTHON = process.platform === "win32" ? "python" : "python3";
const NEXT_BIN = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const COLORS = { next: "\x1b[36m", data: "\x1b[35m", warn: "\x1b[33m", reset: "\x1b[0m" };

const children = [];

function start(name, command, args, { optional = false } = {}) {
  let child;
  try {
    child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
  } catch (err) {
    reportFailure(name, optional, err);
    return;
  }
  const prefix = `${COLORS[name] ?? ""}[${name}]${COLORS.reset}`;
  const pipe = (stream, target) => {
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) target.write(`${prefix} ${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("error", (err) => reportFailure(name, optional, err));
  child.on("exit", (code) => {
    if (optional) {
      process.stdout.write(
        `${COLORS.warn}[warn]${COLORS.reset} data server exited (code ${code}); ticker data will fail.\n`
      );
      return;
    }
    shutdown(code ?? 0);
  });
  children.push(child);
}

function reportFailure(name, optional, err) {
  process.stdout.write(`${COLORS.warn}[warn]${COLORS.reset} ${name} could not start: ${err.message}\n`);
  if (!optional) {
    process.stdout.write(`${COLORS.warn}[warn]${COLORS.reset} run 'npm install' first\n`);
  }
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

start("next", process.execPath, [NEXT_BIN, "dev"]);
start("data", PYTHON, ["python_lib/serve.py"], { optional: true });
