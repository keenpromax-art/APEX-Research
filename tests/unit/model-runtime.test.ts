import { createSuite, check, report, approx } from "../helpers/assert";
import { evalExpression, applyGrowthPath } from "../../src/lib/ai-first/model-runtime";

const suite = createSuite();

const r1 = evalExpression("volume * asp", { volume: 10, asp: 10 });
check(suite, "volume times asp", r1.ok && r1.value === 100);
const r2 = evalExpression("interestIncome - interestExpense", { interestIncome: 620, interestExpense: 440 });
check(suite, "bank nii spread", r2.ok && r2.value === 180);
const r3 = evalExpression("(revenue * margin) - capex", { revenue: 1000, margin: 0.2, capex: 50 });
check(suite, "precedence holds", r3.ok && approx(r3.value, 150, 1e-9));
check(suite, "division by zero rejected", evalExpression("revenue / 0", { revenue: 100 }).ok === false);
check(suite, "unknown variable rejected", evalExpression("revenue * missing", { revenue: 100 }).ok === false);
check(suite, "injection rejected", evalExpression("revenue; process.exit(1)", { revenue: 100 }).ok === false);
check(suite, "function call rejected", evalExpression("process.exit(1)", { revenue: 10 }).ok === false);
const grown = applyGrowthPath(100, [0.1, 0.2, 0.1]);
check(suite, "growth compounds cumulatively", approx(grown[0], 110) && approx(grown[1], 132) && approx(grown[2], 145.2));
check(suite, "empty path returns empty", applyGrowthPath(100, []).length === 0);

report(suite, "unit/model-runtime");
