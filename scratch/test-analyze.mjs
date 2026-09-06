async function test() {
  try {
    const payload = {
      profile: {
        name: 'Suzlon Energy Limited',
        ticker: 'SUZLON.NS',
        sector: 'Industrials',
        industry: 'Specialty Industrial Machinery',
        country: 'India',
        description: 'Suzlon Energy Limited is an India-based renewable energy solutions provider engaged in manufacturing wind turbine generators (WTGs) and providing operations and maintenance (O&M) services.'
      },
      stockData: {
        currentPrice: 45.35,
        marketCap: 618000000000,
        pe: 45.2,
        eps: 1.01
      },
      annualFinancials: [
        {
          year: '2024',
          revenue: 65290000000,
          grossProfit: 28000000000,
          operatingIncome: 8500000000,
          netIncome: 6600000000,
          operatingCashFlow: 7200000000,
          freeCashFlow: 5800000000,
          totalAssets: 85000000000,
          totalLiabilities: 35000000000,
          totalEquity: 50000000000,
          eps: 1.01
        }
      ],
      dcf: {
        intrinsicValue: 48.0,
        verdict: 'HOLD',
        marginOfSafety: 0.06,
        wacc: 0.11,
        terminalGrowthRate: 0.04,
        projections: []
      }
    };

    console.log('Sending request to http://localhost:3000/api/analyze...');
    const res = await fetch('http://localhost:3000/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    console.log('Response status:', res.status);
    const data = await res.json();
    console.log('Response keys:', Object.keys(data));
    if (data.error) {
      console.log('Error message:', data.error);
    } else {
      console.log('AI Analysis sample:', {
        companyOverview: data.aiAnalysis?.companyOverview?.slice(0, 150),
        investmentConclusion: data.aiAnalysis?.investmentConclusion?.slice(0, 150),
      });
    }
  } catch (err) {
    console.error('Test error:', err);
  }
}

test();
