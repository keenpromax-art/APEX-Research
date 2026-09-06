async function testStream() {
  const companyRes = await fetch("http://localhost:3000/api/company?symbol=TMCV.NS");
  const data = await companyRes.json();
  console.log("Company fetched:", data.profile?.name);

  const res = await fetch("http://localhost:3000/api/analyze?stream=true", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
    },
    body: JSON.stringify({
      profile: data.profile,
      stockData: data.stockData,
      annualFinancials: data.annualFinancials,
      dcf: data.dcf,
      news: data.news,
    }),
  });

  console.log("Analyze status:", res.status, "Content-Type:", res.headers.get("content-type"));
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      if (part.startsWith("data: ")) {
        const payload = JSON.parse(part.slice(6));
        if (payload.type === "agent_start") {
          console.log(`[AGENT START] ${payload.name} (${payload.role})`);
        } else if (payload.type === "agent_complete") {
          console.log(`[AGENT COMPLETE] Checkpoint reached: ${payload.name} (${payload.completed}/${payload.total}) in ${payload.durationMs}ms`);
        } else if (payload.type === "done") {
          console.log("[DONE] Full report synthesized successfully!");
        } else {
          console.log("[EVENT]", payload.type);
        }
      }
    }
  }
}

testStream().catch(console.error);
