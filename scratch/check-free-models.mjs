async function check() {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models");
    const json = await res.json();
    const freeModels = json.data.filter(m => m.id.includes(":free")).map(m => m.id);
    console.log("Free models on OpenRouter (" + freeModels.length + "):");
    console.log(freeModels.slice(0, 30).join("\n"));
  } catch (e) {
    console.error(e);
  }
}
check();
