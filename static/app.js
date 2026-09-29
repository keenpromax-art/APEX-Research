const form = document.getElementById("analysis-form");
const tickerInput = document.getElementById("ticker-input");
const analyzeBtn = document.getElementById("analyze-btn");
const statusPanel = document.getElementById("status");
const statusSteps = document.getElementById("status-steps");
const statusBarFill = document.getElementById("status-bar-fill");
const errorPanel = document.getElementById("error");
const errorMessage = document.getElementById("error-message");
const resultEl = document.getElementById("result");
const docTitle = document.getElementById("doc-title");
const docSummary = document.getElementById("doc-summary");
const docMeta = document.getElementById("doc-meta");
const blocksEl = document.getElementById("blocks");
const footerTickers = document.getElementById("footer-tickers");
const footerTimestamp = document.getElementById("footer-timestamp");
const settingsBtn = document.getElementById("settings-btn");
const settingsModal = document.getElementById("settings-modal");
const settingsClose = document.getElementById("settings-close");
const providerSelect = document.getElementById("provider-select");
const apiKeyInput = document.getElementById("api-key-input");
const keySave = document.getElementById("key-save");
const keyClear = document.getElementById("key-clear");
const keyStatus = document.getElementById("key-status");

const LS_PROVIDER = "ere_provider";
const LS_KEY = "ere_key";

function getSavedKey() {
  return { provider: localStorage.getItem(LS_PROVIDER) || "", key: localStorage.getItem(LS_KEY) || "" };
}

function refreshKeyIndicator() {
  const { key } = getSavedKey();
  settingsBtn.classList.toggle("key-active", Boolean(key));
}

settingsBtn.addEventListener("click", () => {
  const { provider, key } = getSavedKey();
  providerSelect.value = provider || "gemini";
  apiKeyInput.value = key;
  keyStatus.textContent = "";
  keyStatus.className = "key-status";
  settingsModal.hidden = false;
  apiKeyInput.focus();
});

settingsClose.addEventListener("click", () => { settingsModal.hidden = true; });
settingsModal.addEventListener("click", (e) => { if (e.target === settingsModal) settingsModal.hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") settingsModal.hidden = true; });

keySave.addEventListener("click", () => {
  const provider = providerSelect.value;
  const key = apiKeyInput.value.trim();
  if (!key) {
    keyStatus.textContent = "Please enter an API key.";
    keyStatus.className = "key-status";
    return;
  }
  localStorage.setItem(LS_PROVIDER, provider);
  localStorage.setItem(LS_KEY, key);
  keyStatus.textContent = `Saved. Analyses will use ${provider} with your key.`;
  keyStatus.className = "key-status ok";
  refreshKeyIndicator();
});

keyClear.addEventListener("click", () => {
  localStorage.removeItem(LS_PROVIDER);
  localStorage.removeItem(LS_KEY);
  apiKeyInput.value = "";
  keyStatus.textContent = "Saved key cleared. The server-side configuration will be used.";
  keyStatus.className = "key-status";
  refreshKeyIndicator();
});

refreshKeyIndicator();

const PIPELINE_STEPS = [
  "Fetching data...",
  "Preparing financial context...",
  "AI analyzing...",
  "Rendering analysis...",
];

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const tickers = tickerInput.value.trim();
  if (!tickers) return;
  runAnalysis(tickers);
});

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    tickerInput.value = chip.dataset.ticker;
    runAnalysis(chip.dataset.ticker);
  });
});

function runAnalysis(tickers) {
  resultEl.hidden = true;
  errorPanel.hidden = true;
  statusPanel.hidden = false;
  analyzeBtn.disabled = true;
  analyzeBtn.querySelector(".btn-label").textContent = "Analyzing...";
  renderStatusSteps(-1);
  statusBarFill.style.width = "4%";

  const { provider, key } = getSavedKey();
  let url = `/api/analyze?tickers=${encodeURIComponent(tickers)}`;
  if (provider && key) {
    url += `&provider=${encodeURIComponent(provider)}&key=${encodeURIComponent(key)}`;
  }
  const source = new EventSource(url);

  source.addEventListener("status", (e) => {
    const idx = PIPELINE_STEPS.indexOf(e.data);
    if (idx >= 0) {
      renderStatusSteps(idx);
      statusBarFill.style.width = `${((idx + 1) / PIPELINE_STEPS.length) * 100}%`;
    }
  });

  source.addEventListener("result", (e) => {
    source.close();
    finishStatus();
    const doc = JSON.parse(e.data);
    renderDocument(doc);
  });

  source.addEventListener("error", (e) => {
    source.close();
    finishStatus();
    let message = "Analysis failed.";
    try {
      const payload = JSON.parse(e.data);
      if (payload && payload.message) message = payload.message;
    } catch (_) {}
    errorMessage.textContent = message;
    errorPanel.hidden = false;
  });
}

function renderStatusSteps(activeIdx) {
  statusSteps.innerHTML = "";
  PIPELINE_STEPS.forEach((label, i) => {
    const step = document.createElement("div");
    step.className = "status-step" + (i < activeIdx ? " done" : i === activeIdx ? " active" : "");
    const icon = i < activeIdx ? "✓" : "";
    step.innerHTML = `<span class="step-icon">${icon}</span><span>${label}</span>`;
    statusSteps.appendChild(step);
  });
}

function finishStatus() {
  statusPanel.hidden = true;
  analyzeBtn.disabled = false;
  analyzeBtn.querySelector(".btn-label").textContent = "Analyze";
  statusBarFill.style.width = "0%";
}

function renderDocument(doc) {
  docTitle.textContent = doc.title || "Analysis";
  docSummary.textContent = doc.summary || "";
  blocksEl.innerHTML = "";
  for (const block of doc.blocks || []) {
    const el = renderBlock(block);
    if (el) blocksEl.appendChild(el);
  }
  const meta = doc.meta || {};
  const tickers = (meta.tickers || []).join(", ");
  docMeta.innerHTML = `<span class="ticker-tag">${tickers}</span><span>generated ${formatDate(meta.generatedAt)}</span>`;
  footerTickers.textContent = `Ticker(s): ${tickers}`;
  footerTimestamp.textContent = formatDate(meta.generatedAt);
  resultEl.hidden = false;
  resultEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function formatDate(iso) {
  if (!iso) return "unknown";
  try {
    return new Date(iso).toLocaleString();
  } catch (_) {
    return iso;
  }
}

function renderBlock(block) {
  switch (block.type) {
    case "heading": return renderHeading(block);
    case "paragraph": return renderParagraph(block);
    case "metric": return renderMetric(block);
    case "table": return renderTable(block);
    case "chart": return renderChart(block);
    case "callout": return renderCallout(block);
    case "list": return renderList(block);
    case "formula": return renderFormula(block);
    case "provenance": return renderProvenance(block);
    default: return null;
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderHeading(block) {
  return el("h" + Math.min(Math.max(block.level || 2, 2), 4), `block-heading level-${block.level || 2}`, block.content);
}

function renderParagraph(block) {
  const node = el("p", "block-paragraph", block.content);
  if (block.epistemic) {
    node.appendChild(el("span", "epistemic-tag", block.epistemic));
  }
  return node;
}

function renderMetric(block) {
  const grid = el("div", "metric-grid");
  const card = el("div", "metric-card");
  card.appendChild(el("div", "metric-label", block.label));
  const valueRow = el("div", "");
  valueRow.appendChild(el("span", "metric-value", formatValue(block.value, block.unit)));
  if (block.change !== null && block.change !== undefined) {
    const dir = block.change >= 0 ? "up" : "down";
    const sign = block.change >= 0 ? "+" : "";
    valueRow.appendChild(el("span", `metric-change ${dir}`, `${sign}${(block.change * 100).toFixed(1)}%`));
  }
  card.appendChild(valueRow);
  grid.appendChild(card);
  return grid;
}

function formatValue(value, unit) {
  if (value === null || value === undefined) return "N/A";
  if (unit === "percent") return `${(value * 100).toFixed(1)}%`;
  if (unit === "currency") {
    const abs = Math.abs(value);
    if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  if (unit === "ratio") return `${value.toFixed(2)}x`;
  if (unit === "number" && Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (unit === "number" && Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function renderTable(block) {
  const wrap = el("div", "table-wrap");
  const table = el("table", "block-table");
  const thead = el("thead");
  const headerRow = el("tr");
  for (const col of block.columns || []) {
    headerRow.appendChild(el("th", "", col));
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);
  const tbody = el("tbody");
  for (const row of block.rows || []) {
    const tr = el("tr");
    for (const cell of row) {
      const isNum = typeof cell === "number";
      tr.appendChild(el("td", isNum ? "num" : "", isNum ? formatValue(cell, "number") : (cell ?? "—")));
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

const CALLOUT_ICONS = {
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
  warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  uncertainty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>',
  fact: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>',
};

function renderCallout(block) {
  const node = el("div", `callout ${block.variant || "info"}`);
  const icon = document.createElement("span");
  icon.innerHTML = CALLOUT_ICONS[block.variant] || CALLOUT_ICONS.info;
  node.appendChild(icon.firstChild);
  node.appendChild(el("span", "", block.content));
  return node;
}

function renderList(block) {
  const tag = block.ordered ? "ol" : "ul";
  const node = el(tag, "block-list");
  for (const item of block.items || []) {
    node.appendChild(el("li", "", item));
  }
  return node;
}

function renderFormula(block) {
  const node = el("div", "formula", block.expression);
  if (block.result !== null && block.result !== undefined) {
    node.appendChild(el("span", "", ` = ${formatValue(block.result, "number")}`));
  }
  return node;
}

function renderProvenance(block) {
  const node = el("div", "provenance");
  const list = el("ul", "block-list");
  for (const item of block.items || []) {
    const value = item.value === null || item.value === undefined ? "N/A" : formatValue(item.value, "number");
    list.appendChild(el("li", "", `${item.claim} — ${value} (${item.source})`));
  }
  node.appendChild(list);
  return node;
}

function renderChart(block) {
  const card = el("div", "chart-card");
  card.appendChild(el("div", "chart-title", block.title || ""));
  const points = block.data || [];
  if (!points.length) return card;

  const width = 800;
  const height = 260;
  const padding = { top: 16, right: 16, bottom: 26, left: 60 };
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "chart-svg");

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.innerHTML = `<linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#5b8cff" stop-opacity="0.35"/>
    <stop offset="100%" stop-color="#5b8cff" stop-opacity="0"/>
  </linearGradient>`;
  svg.appendChild(defs);

  const x = (i) => padding.left + (i / Math.max(points.length - 1, 1)) * (width - padding.left - padding.right);
  const y = (v) => padding.top + (1 - (v - min) / span) * (height - padding.top - padding.bottom);

  for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
    const gy = padding.top + frac * (height - padding.top - padding.bottom);
    const grid = document.createElementNS("http://www.w3.org/2000/svg", "line");
    grid.setAttribute("x1", padding.left);
    grid.setAttribute("x2", width - padding.right);
    grid.setAttribute("y1", gy);
    grid.setAttribute("y2", gy);
    grid.setAttribute("class", "chart-grid");
    svg.appendChild(grid);
    const label = el("text", "chart-label", formatValue(max - frac * span, "number"));
    label.setAttribute("x", 6);
    label.setAttribute("y", gy + 3);
    svg.appendChild(label);
  }

  const axis = document.createElementNS("http://www.w3.org/2000/svg", "line");
  axis.setAttribute("x1", padding.left);
  axis.setAttribute("x2", width - padding.right);
  axis.setAttribute("y1", height - padding.bottom);
  axis.setAttribute("y2", height - padding.bottom);
  axis.setAttribute("class", "chart-axis");
  svg.appendChild(axis);

  if ((block.chartType || "line") === "bar") {
    const slot = (width - padding.left - padding.right) / points.length;
    const barWidth = Math.max(3, slot * 0.65);
    points.forEach((p, i) => {
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", x(i) - barWidth / 2);
      rect.setAttribute("y", y(p.value));
      rect.setAttribute("width", barWidth);
      rect.setAttribute("height", Math.max(1, height - padding.bottom - y(p.value)));
      rect.setAttribute("rx", 3);
      rect.setAttribute("class", "chart-bar");
      svg.appendChild(rect);
    });
  } else {
    const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`).join(" ");
    const areaPath = `${linePath} L${x(points.length - 1)},${height - padding.bottom} L${x(0)},${height - padding.bottom} Z`;
    const area = document.createElementNS("http://www.w3.org/2000/svg", "path");
    area.setAttribute("d", areaPath);
    area.setAttribute("class", "chart-area");
    svg.appendChild(area);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("d", linePath);
    line.setAttribute("class", "chart-line");
    svg.appendChild(line);

    const lastIdx = points.length - 1;
    const endDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    endDot.setAttribute("cx", x(lastIdx));
    endDot.setAttribute("cy", y(points[lastIdx].value));
    endDot.setAttribute("r", 3.5);
    endDot.setAttribute("fill", "#5b8cff");
    svg.appendChild(endDot);
  }

  const firstLabel = el("text", "chart-label", points[0].label);
  firstLabel.setAttribute("x", padding.left);
  firstLabel.setAttribute("y", height - 8);
  svg.appendChild(firstLabel);
  const lastLabel = el("text", "chart-label", points[points.length - 1].label);
  lastLabel.setAttribute("x", width - padding.right);
  lastLabel.setAttribute("y", height - 8);
  lastLabel.setAttribute("text-anchor", "end");
  svg.appendChild(lastLabel);

  card.appendChild(svg);
  return card;
}
