async function getFreeModels() {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models");
    const json = await res.json();
    const freeModels = json.data.filter(m => m.id.endsWith(":free"));
    console.log("Free models found:", freeModels.length);
    console.log(freeModels.slice(0, 15).map(m => m.id));
  } catch (e) {
    console.error(e);
  }
}
getFreeModels();
