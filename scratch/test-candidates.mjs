import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const candidates = [
  'minimax/minimax-m3:free',
  'dots-studio/dots-3-note-preview:free',
  'liquid/lfm-2.5-2.6b:free',
  'nvidia/nemotron-3.5-lightning:free',
  'z-ai/glm-5.2:free'
];

async function check() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  for (const m of candidates) {
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
        messages: [{ role: "user", content: "Test" }],
        max_tokens: 5,
      }),
    });
    console.log(m, "status:", res.status);
  }
}
check();
