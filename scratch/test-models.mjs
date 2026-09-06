import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const models = [
  "google/gemini-2.0-flash-lite:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "deepseek/deepseek-r1:free",
  "mistralai/mistral-7b-instruct:free",
  "google/gemini-flash-1.5",
  "openai/gpt-4o-mini",
];

async function testModels() {
  const apiKey = process.env.OPENROUTER_API_KEY;

  for (const model of models) {
    console.log("--- Testing model:", model, "---");
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
            { role: "user", content: "Say hello in 3 words." },
          ],
          max_tokens: 20,
        }),
      });

      console.log("Status:", res.status);
      const data = await res.json();
      if (res.status === 200) {
        console.log("SUCCESS with", model, ":", data.choices?.[0]?.message?.content);
        break;
      } else {
        console.log("Error:", data.error?.message?.slice(0, 100));
      }
    } catch (e) {
      console.error(e.message);
    }
  }
}

testModels();
