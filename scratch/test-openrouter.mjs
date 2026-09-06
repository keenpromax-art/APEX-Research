import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function testOpenRouter() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || "google/gemini-flash-1.5";
  console.log("Testing with model:", model);

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Equity Research Report Generator",
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: "You are a senior equity research analyst." },
          { role: "user", content: "Give a 1-sentence institutional equity summary for Apple Inc." },
        ],
        temperature: 0.7,
        max_tokens: 100,
      }),
    });

    console.log("Status:", res.status);
    const data = await res.json();
    console.log("Response:", JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Fetch error:", err);
  }
}

testOpenRouter();
