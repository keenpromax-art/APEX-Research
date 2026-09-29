"use client";

import { useState } from "react";

const LS_PROVIDER = "ere_provider";
const LS_KEY = "ere_key";
const LS_MODEL = "ere_model";

const MODEL_OPTIONS: Record<string, { value: string; label: string }[]> = {
  gemini: [
    { value: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
    { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ],
  openrouter: [
    { value: "google/gemini-flash-1.5", label: "Gemini Flash 1.5" },
    { value: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash" },
    { value: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
    { value: "openai/gpt-4o-mini", label: "GPT-4o mini" },
  ],
  groq: [
    { value: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B" },
    { value: "openai/gpt-oss-120b", label: "GPT OSS 120B" },
    { value: "openai/gpt-oss-20b", label: "GPT OSS 20B" },
  ],
};

export function getSavedKey(): { provider: string; key: string; model: string } {
  if (typeof window === "undefined") return { provider: "", key: "", model: "" };
  return {
    provider: window.localStorage.getItem(LS_PROVIDER) ?? "",
    key: window.localStorage.getItem(LS_KEY) ?? "",
    model: window.localStorage.getItem(LS_MODEL) ?? "",
  };
}

export function hasSavedKey(): boolean {
  return Boolean(getSavedKey().key);
}

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [provider, setProvider] = useState(getSavedKey().provider || "gemini");
  const [key, setKey] = useState(getSavedKey().key);
  const [model, setModel] = useState(getSavedKey().model || MODEL_OPTIONS[provider][0].value);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);

  const models = MODEL_OPTIONS[provider] ?? [];

  const onProviderChange = (next: string) => {
    setProvider(next);
    setModel(MODEL_OPTIONS[next][0].value);
  };

  const save = () => {
    if (!key.trim()) {
      setStatus({ text: "Please enter an API key.", ok: false });
      return;
    }
    window.localStorage.setItem(LS_PROVIDER, provider);
    window.localStorage.setItem(LS_KEY, key.trim());
    window.localStorage.setItem(LS_MODEL, model);
    setStatus({ text: `Saved. Analyses will use ${provider} / ${model} with your key.`, ok: true });
  };

  const clear = () => {
    window.localStorage.removeItem(LS_PROVIDER);
    window.localStorage.removeItem(LS_KEY);
    window.localStorage.removeItem(LS_MODEL);
    setKey("");
    setStatus({ text: "Saved key cleared. The server-side configuration will be used.", ok: false });
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="modal-header">
          <h3 id="settings-title">AI Provider Settings</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </div>
        <p className="modal-hint">
          Bring your own AI key. It is stored only in your browser (localStorage) and sent
          with each analysis request. The server never persists it.
        </p>
        <label className="field-label" htmlFor="provider-select">Provider</label>
        <select id="provider-select" value={provider} onChange={(e) => onProviderChange(e.target.value)}>
          <option value="gemini">Google Gemini</option>
          <option value="openrouter">OpenRouter</option>
          <option value="groq">Groq</option>
        </select>
        <label className="field-label" htmlFor="model-select">Model</label>
        <select id="model-select" value={model} onChange={(e) => setModel(e.target.value)}>
          {models.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        <label className="field-label" htmlFor="api-key-input">API key</label>
        <input
          id="api-key-input"
          type="password"
          placeholder="Paste your API key"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <div className="modal-actions">
          <button className="btn-ghost" onClick={clear}>Clear saved key</button>
          <button className="btn-primary" onClick={save}>Save</button>
        </div>
        {status && <p className={`key-status${status.ok ? " ok" : ""}`}>{status.text}</p>}
      </div>
    </div>
  );
}
