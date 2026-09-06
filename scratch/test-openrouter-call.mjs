async function test() {
  const apiKey = process.env.OPENROUTER_API_KEY || "YOUR_API_KEY_HERE";
  const models = [
    "google/gemini-2.0-flash-001",
    "google/gemini-flash-1.5",
    "meta-llama/llama-3.3-70b-instruct:free",
    "mistralai/mistral-7b-instruct:free",
    "inclusionai/ling-3.0-flash-fin:free"
  ];

  for (const model of models) {
    try {
      console.log(`Testing model: ${model}...`);
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "Equity Research Generator",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are a senior Private Equity analyst." },
            { role: "user", content: "Write a 2-sentence PE thesis for Suzlon Energy." }
          ],
          max_tokens: 100,
        }),
      });

      console.log(`Status for ${model}:`, res.status);
      if (res.ok) {
        const json = await res.json();
        console.log(`Success with ${model}:`, json.choices?.[0]?.message?.content);
        break;
      } else {
        const err = await res.text();
        console.log(`Failed for ${model}:`, err);
      }
    } catch (e) {
      console.log(`Exception for ${model}:`, e.message);
    }
  }
}

test();
