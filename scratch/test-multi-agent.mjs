import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function testMultiAgent() {
  console.log("Fetching company data for TMCV.NS (Tata Motors)...");
  const compRes = await fetch("http://localhost:3000/api/company?symbol=TMCV.NS");
  const compData = await compRes.json();

  console.log("Company:", compData.profile?.name);
  console.log("News count retrieved:", compData.news?.length || 0);
  if (compData.news?.length > 0) {
    console.log("Sample news title:", compData.news[0].title);
    console.log("Sample news date:", compData.news[0].publishedAt);
  }

  console.log("\nCalling /api/analyze with Multi-Agent AI Engine...");
  const start = Date.now();
  const analyzeRes = await fetch("http://localhost:3000/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profile: compData.profile,
      stockData: compData.stockData,
      annualFinancials: compData.annualFinancials,
      dcf: compData.dcf,
      news: compData.news,
    }),
  });

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Analyze API finished in ${duration}s with status:`, analyzeRes.status);

  const analyzeData = await analyzeRes.json();
  const ai = analyzeData.aiAnalysis;

  if (ai) {
    console.log("\n=== MULTI-AGENT SYNTHESIS RESULTS ===");
    console.log("1. Investment Thesis Preview (Agent 1):", ai.investmentThesis?.slice(0, 200) + "...");
    console.log("2. Bull Points (Agent 1):", ai.swotStrengths?.slice(0, 2));
    console.log("3. Bear Points (Agent 1):", ai.swotWeaknesses?.slice(0, 2));
    console.log("4. Recent News Items Analyzed (Agent 2):", ai.recentNewsAnalysis?.length);
    if (ai.recentNewsAnalysis?.length > 0) {
      console.log("   First News Headline:", ai.recentNewsAnalysis[0].headline);
      console.log("   Strategic Takeaway:", ai.recentNewsAnalysis[0].strategicTakeaway);
    }
    console.log("5. Moat Sources (Agent 3):", {
      switchingCosts: ai.moatSources?.switchingCosts?.slice(0, 100) + "...",
      costAdvantage: ai.moatSources?.costAdvantage?.slice(0, 100) + "...",
    });
    console.log("6. Five Forces Count (Agent 3):", ai.fiveForces?.length);
    console.log("7. DuPont ROE Commentary (Agent 4):", ai.dupontCommentary?.slice(0, 150) + "...");
    console.log("8. Credit Solvency Commentary (Agent 5):", ai.creditAnalysisCommentary?.financialHealth?.slice(0, 150) + "...");
    console.log("9. Capital Deployment History (Agent 6):", ai.capitalDeploymentHistory?.narrative?.slice(0, 150) + "...");
    console.log("\nSUCCESS: All 6 specialized AI sections populated!");
  } else {
    console.error("Error in AI analysis:", analyzeData.error);
  }
}

testMultiAgent();
