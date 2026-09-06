import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const freeList = [
  'google/gemma-4-26b-a4b-it:free',
  'minimax/minimax-m3:free',
  'liquid/lfm-2.5-2.6b:free',
  'dots-studio/dots-3-note-preview:free',
];

async function testFree() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  for (const m of freeList) {
    console.log("Testing:", m);
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Equity Research Report Generator",
      },
      body: JSON.stringify({
        model: m,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 10,
      }),
    });
    console.log("Status:", res.status);
    const d = await res.json();
    if (res.status === 200) {
      console.log("SUCCESS with", m, d.choices?.[0]?.message?.content);
      break;
    } else {
      console.log("Error:", d.error?.message?.slice(0, 80));
    }
  }
}
testFree();
