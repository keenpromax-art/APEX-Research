import { createSuite, check, report } from "../helpers/assert";
import { selectAccountingArchitecture, getAccountingArchitecture, ACCOUNTING_ARCHITECTURES } from "../../src/lib/ai-first/accounting-architecture";

const suite = createSuite();

check(suite, "registry exposes six architectures", ACCOUNTING_ARCHITECTURES.length === 6);
check(suite, "corporate contract requires revenue and netIncome", getAccountingArchitecture("corporate").requiredLines.includes("revenue"));
check(suite, "depository contract requires net interest lines", getAccountingArchitecture("depository").requiredLines.includes("netInterestIncome"));
check(suite, "insurance contract requires premiums and claims", getAccountingArchitecture("insurance").requiredLines.includes("premiums"));
check(suite, "reit contract requires rental income", getAccountingArchitecture("reit").requiredLines.includes("rentalIncome"));
check(suite, "fee_based contract requires fee revenue", getAccountingArchitecture("fee_based").requiredLines.includes("feeRevenue"));
check(suite, "conglomerate contract supports segmented model", getAccountingArchitecture("conglomerate").statementModel === "segmented");

check(suite, "bank evidence selects depository", selectAccountingArchitecture({ understanding: { whatItDoes: "takes deposits and makes loans", howItMakesMoney: "net interest income" } }).id === "depository");
check(suite, "insurance evidence selects insurance", selectAccountingArchitecture({ understanding: { whatItDoes: "underwrites insurance policies", howItMakesMoney: "premiums and claims" } }).id === "insurance");
check(suite, "reit evidence selects reit", selectAccountingArchitecture({ understanding: { whatItDoes: "real estate investment trust", howItMakesMoney: "rental income and occupancy" } }).id === "reit");
check(suite, "fee evidence selects fee_based", selectAccountingArchitecture({ understanding: { whatItDoes: "asset management company", howItMakesMoney: "management fees on AUM" } }).id === "fee_based");
check(suite, "manufacturing evidence selects corporate", selectAccountingArchitecture({ understanding: { whatItDoes: "manufactures products", howItMakesMoney: "volume times price" } }).id === "corporate");
check(suite, "diversified evidence selects conglomerate", selectAccountingArchitecture({ understanding: { whatItDoes: "diversified conglomerate", businessSegments: [{ name: "a", description: "segment a" }, { name: "b", description: "segment b" }] } }).id === "conglomerate");
check(suite, "empty evidence falls back to corporate", selectAccountingArchitecture({}).id === "corporate");
check(suite, "declared architecture wins over evidence", selectAccountingArchitecture({ declaredArchitecture: "insurance", understanding: { whatItDoes: "takes deposits" } }).id === "insurance");
check(suite, "selection is frozen and scored", Object.isFrozen(selectAccountingArchitecture({ understanding: { whatItDoes: "takes deposits" } })));

report(suite, "unit/accounting-architecture");
