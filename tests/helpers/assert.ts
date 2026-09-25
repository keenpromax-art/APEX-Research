export interface SuiteCounts {
  passed: number;
  failed: number;
}

export function createSuite(): SuiteCounts {
  return { passed: 0, failed: 0 };
}

export function check(suite: SuiteCounts, name: string, cond: boolean, detail?: string): void {
  if (cond) {
    suite.passed += 1;
    console.log(`  PASS ${name}`);
  } else {
    suite.failed += 1;
    console.error(`  FAIL ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

export function report(suite: SuiteCounts, label: string): void {
  console.log(`RESULT ${label}: ${suite.passed} passed, ${suite.failed} failed`);
  if (suite.failed > 0) {
    process.exit(1);
  }
}

export function approx(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol;
}

export function mustEnv(name: string): string | null {
  const v = (process.env as Record<string, string | undefined>)[name];
  return v === undefined || v === "" ? null : v;
}
