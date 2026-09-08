"use client";
import React, { useState, useEffect } from "react";
import {
  SUPPORTED_PROVIDERS,
  SupportedProvider,
  CustomKeyConfig,
} from "@/lib/ai-providers";
import styles from "./ApiKeyModal.module.css";

export const LOCAL_STORAGE_KEY = "apex_custom_ai_config";

export function loadSavedAiConfig(): CustomKeyConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.apiKey && parsed.provider) {
      return parsed as CustomKeyConfig;
    }
  } catch {}
  return null;
}

export function saveAiConfig(config: CustomKeyConfig | null): void {
  if (typeof window === "undefined") return;
  try {
    if (config && config.apiKey) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(config));
    } else {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
  } catch {}
}

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: CustomKeyConfig | null, retryAnalysis?: boolean) => void;
  isRateLimitTriggered?: boolean;
  rateLimitInfo?: { provider?: string; message?: string; kind?: string } | null;
  currentConfig?: CustomKeyConfig | null;
}

export default function ApiKeyModal({
  isOpen,
  onClose,
  onSave,
  isRateLimitTriggered = false,
  rateLimitInfo,
  currentConfig,
}: ApiKeyModalProps) {
  const [activeProvider, setActiveProvider] = useState<SupportedProvider>("nvidia");
  const [apiKey, setApiKey] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [isCustomModel, setIsCustomModel] = useState<boolean>(false);
  const [customModel, setCustomModel] = useState<string>("");
  const [isPasswordVisible, setIsPasswordVisible] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    preview?: string;
  } | null>(null);

  // Sync state whenever modal opens or currentConfig changes
  useEffect(() => {
    if (!isOpen) return;

    const active = currentConfig || loadSavedAiConfig();
    if (active && active.apiKey) {
      setActiveProvider(active.provider);
      setApiKey(active.apiKey);
      const activeModel = active.model || SUPPORTED_PROVIDERS[active.provider]?.defaultModel || "";
      setModel(activeModel);
      const isCustom = Boolean(activeModel && !SUPPORTED_PROVIDERS[active.provider]?.candidateModels.includes(activeModel));
      setIsCustomModel(isCustom);
      setCustomModel(isCustom ? activeModel : "");
    } else {
      // Default to NVIDIA NIM or OpenRouter
      const defProvider: SupportedProvider = isRateLimitTriggered ? "nvidia" : "openrouter";
      setActiveProvider(defProvider);
      setApiKey("");
      const defModel = SUPPORTED_PROVIDERS[defProvider]?.defaultModel || "";
      setModel(defModel);
      setIsCustomModel(false);
      setCustomModel("");
    }
    setTestResult(null);
    setIsPasswordVisible(false);
  }, [isOpen, currentConfig, isRateLimitTriggered]);

  if (!isOpen) return null;

  const currentProviderMeta = SUPPORTED_PROVIDERS[activeProvider];

  // Accurate header for the actual failure: the old copy always blamed the
  // server key, even when the user's own custom key was the one throttled.
  const failureKind = rateLimitInfo?.kind || "rate_limited";
  const savedKeyActive = Boolean((currentConfig || loadSavedAiConfig())?.apiKey);
  const usingCustomKey = savedKeyActive;
  const isPaused = Boolean(isRateLimitTriggered && (rateLimitInfo as any)?.paused);
  const pausedDone = (rateLimitInfo as any)?.completed ?? 0;
  const pausedTotal = (rateLimitInfo as any)?.total ?? 7;
  const pausedNext = (rateLimitInfo as any)?.nextAgent;
  const modalTitle = !isRateLimitTriggered
    ? "AI Model Provider & API Key Settings"
    : isPaused
    ? "Paused — Progress Saved"
    : failureKind === "invalid_key"
    ? "Invalid API Key"
    : failureKind === "key_exhausted"
    ? "Custom Key Out of Credits"
    : usingCustomKey
    ? "Custom Key Rate Limit Exceeded"
    : "Server Rate Limit Exceeded";
  const modalCopy = !isRateLimitTriggered
    ? "The website uses the server's default API key. You can connect your own custom provider key at any time for unlimited personal throughput."
    : isPaused
    ? `${pausedDone} of ${pausedTotal} agents already finished and their work is banked. Saving resumes with ${pausedNext || "the next agent"} — finished agents are skipped, nothing restarts. If throttling persists, wait ~60s (free-tier per-minute quota) before resuming.`
    : failureKind === "invalid_key"
    ? "The provider rejected this API key (401). Re-check the key value, use Test Key Connection, then save again — retrying the same key will fail identically."
    : failureKind === "key_exhausted"
    ? "This key is out of credits/quota, so every model on it fails the same way — switching models won't help. Top up the account or pick a provider with an active free tier, then resume."
    : usingCustomKey
    ? "Your custom key was throttled (HTTP 429). Free-tier keys allow roughly 20 requests/min and one full report issues ~8 slowly-paced requests. Wait about 60 seconds (resuming auto-cools-down 30s), or switch to NVIDIA NIM / Groq free tiers."
    : "The default institutional server key reached its request quota. Supply an API key from any supported provider to resume immediate analysis.";

  const handleProviderSelect = (p: SupportedProvider) => {
    setActiveProvider(p);
    setTestResult(null);
    const meta = SUPPORTED_PROVIDERS[p];
    // If the saved config was for this provider, reload its saved key/model
    const saved = currentConfig || loadSavedAiConfig();
    if (saved && saved.provider === p) {
      setApiKey(saved.apiKey);
      const m = saved.model || meta.defaultModel;
      setModel(m);
      const isCustom = Boolean(m && !meta.candidateModels.includes(m));
      setIsCustomModel(isCustom);
      setCustomModel(isCustom ? m : "");
    } else {
      setModel(meta.defaultModel);
      setIsCustomModel(false);
      setCustomModel("");
    }
  };

  const handleTestConnection = async () => {
    if (!apiKey.trim()) {
      setTestResult({ success: false, message: "Please enter an API key first." });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const res = await fetch("/api/test-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: activeProvider,
          apiKey: apiKey.trim(),
          model: model.trim() || currentProviderMeta.defaultModel,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult({
          success: true,
          message: data.message || "✓ Connection verified!",
          preview: data.preview,
        });
      } else {
        setTestResult({
          success: false,
          message: data.error || `HTTP ${res.status}: Verification failed.`,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({ success: false, message: `Network test failed: ${msg}` });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = () => {
    if (!apiKey.trim()) {
      setTestResult({ success: false, message: "Please enter a valid API key to save." });
      return;
    }

    const config: CustomKeyConfig = {
      provider: activeProvider,
      apiKey: apiKey.trim(),
      model: model.trim() || currentProviderMeta.defaultModel,
    };

    saveAiConfig(config);
    onSave(config, isRateLimitTriggered);
    onClose();
  };

  const handleResetToDefault = () => {
    saveAiConfig(null);
    setApiKey("");
    setTestResult(null);
    onSave(null, false);
    onClose();
  };

  const hasSavedCustomKey = Boolean((currentConfig || loadSavedAiConfig())?.apiKey);

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={`${styles.modalContent} ${isRateLimitTriggered ? styles.modalContentAlert : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={styles.modalHeader}>
          <div className={styles.headerTitleGroup}>
            <div
              className={`${styles.headerIcon} ${isRateLimitTriggered ? styles.headerIconAlert : ""}`}
            >
              {isRateLimitTriggered ? "⚠️" : "🔑"}
            </div>
            <div className={styles.headerText}>
              <h3>
                {modalTitle}
              </h3>
              <p>
                {modalCopy}
              </p>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className={styles.modalBody}>
          {/* Rate Limit Alert Banner (if triggered) */}
          {isRateLimitTriggered && (
            <div className={styles.rateLimitBanner}>
              <span className={styles.bannerIcon}>🚨</span>
              <div className={styles.bannerText}>
                <strong>{failureKind === "invalid_key" ? "Invalid Key:" : failureKind === "key_exhausted" ? "Out of Credits:" : "Rate Limit Active:"}</strong>
                {rateLimitInfo?.message ||
                  "Server OpenRouter free-tier rate limit reached. Connect your NVIDIA, Gemini, Groq, or OpenRouter key to continue."}
                {failureKind !== "invalid_key" && failureKind !== "key_exhausted" && (
                  <div style={{ marginTop: 4, fontSize: "0.78rem", opacity: 0.85 }}>
                    Saving resumes automatically after a 30s cooldown, and generation itself runs slowly on purpose (one request at a time). If it throttles again, wait ~60s (free-tier per-minute quota) before retrying — or switch model/provider.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Current Active Status Indicator */}
          <div className={styles.statusCard}>
            <span className={styles.statusLabel}>Current Key Configuration</span>
            {hasSavedCustomKey ? (
              <span className={`${styles.statusValue} ${styles.statusCustom}`}>
                <span>●</span> Custom Provider Active (
                {SUPPORTED_PROVIDERS[(currentConfig || loadSavedAiConfig())!.provider]?.name})
              </span>
            ) : (
              <span className={`${styles.statusValue} ${styles.statusDefault}`}>
                <span>●</span> Default Institutional Server Key (Active)
              </span>
            )}
          </div>

          {/* Provider Selection Tabs */}
          <div>
            <div className={styles.providerTabsLabel}>Select AI Provider</div>
            <div className={styles.providerGrid}>
              {(Object.keys(SUPPORTED_PROVIDERS) as SupportedProvider[]).map((pid) => {
                const pMeta = SUPPORTED_PROVIDERS[pid];
                const isActive = activeProvider === pid;
                return (
                  <button
                    key={pid}
                    type="button"
                    className={`${styles.providerCard} ${isActive ? styles.providerCardActive : ""}`}
                    onClick={() => handleProviderSelect(pid)}
                  >
                    <span className={styles.providerName}>{pMeta.name}</span>
                    <span className={styles.providerBadge}>{pMeta.badge}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Provider Configuration Box */}
          <div className={styles.providerConfigBox}>
            <div className={styles.providerInfoRow}>
              <p className={styles.providerDesc}>{currentProviderMeta.description}</p>
              <a
                href={currentProviderMeta.portalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.portalLink}
              >
                Get Key at {currentProviderMeta.portalName} ↗
              </a>
            </div>

            {currentProviderMeta.isFreeTierAvailable && (
              <div className={styles.freeTierNotice}>
                <span>💡</span> {currentProviderMeta.freeTierNote}
              </div>
            )}

            {/* API Key Input */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                <span>{currentProviderMeta.name} API Key</span>
                <span style={{ fontSize: "0.7rem", color: "#6B7280" }}>
                  Stored securely in browser localStorage only
                </span>
              </label>
              <div className={styles.inputWrapper}>
                <input
                  type={isPasswordVisible ? "text" : "password"}
                  className={styles.textInput}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={`e.g. ${currentProviderMeta.keyPlaceholder}`}
                  autoComplete="off"
                  spellCheck="false"
                />
                <button
                  type="button"
                  className={styles.revealToggle}
                  onClick={() => setIsPasswordVisible(!isPasswordVisible)}
                  title={isPasswordVisible ? "Hide key" : "Show key"}
                >
                  {isPasswordVisible ? "🙈" : "👁️"}
                </button>
              </div>
            </div>

            {/* Model Selection */}
            <div className={styles.formGroup}>
              <div className={styles.formLabel}>
                <span>Model Designation (Optional Override)</span>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <button
                    type="button"
                    className={styles.modeToggleBtn}
                    onClick={() => {
                      if (isCustomModel) {
                        setIsCustomModel(false);
                        setModel(currentProviderMeta.defaultModel);
                      } else {
                        setIsCustomModel(true);
                        setCustomModel(model || "");
                      }
                    }}
                  >
                    {isCustomModel ? "📋 Pick from Presets" : "✏️ Custom Model ID"}
                  </button>
                  <span style={{ fontSize: "0.7rem", color: "#6B7280" }}>
                    Default: {currentProviderMeta.defaultModel}
                  </span>
                </div>
              </div>

              {!isCustomModel ? (
                <select
                  className={styles.modelSelect}
                  value={model || currentProviderMeta.defaultModel}
                  onChange={(e) => {
                    if (e.target.value === "__custom__") {
                      setIsCustomModel(true);
                      setCustomModel("");
                      setModel("");
                    } else {
                      setModel(e.target.value);
                    }
                  }}
                >
                  {currentProviderMeta.candidateModels.map((m) => (
                    <option key={m} value={m}>
                      {m} {m === currentProviderMeta.defaultModel ? " (Recommended)" : ""}
                    </option>
                  ))}
                  <option value="__custom__">✏️ Custom / Enter own model ID...</option>
                </select>
              ) : (
                <div>
                  <div className={styles.inputWrapper}>
                    <input
                      type="text"
                      className={styles.textInput}
                      value={customModel}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCustomModel(val);
                        setModel(val);
                      }}
                      placeholder={`e.g. ${
                        activeProvider === "nvidia"
                          ? "meta/llama-3.1-405b-instruct or deepseek-ai/deepseek-v3"
                          : activeProvider === "openrouter"
                          ? "anthropic/claude-3.5-sonnet or deepseek/deepseek-r1"
                          : activeProvider === "groq"
                          ? "deepseek-r1-distill-llama-70b"
                          : activeProvider === "gemini"
                          ? "gemini-2.5-pro or gemini-2.0-pro-exp-02-05"
                          : "gpt-4o or o3-mini"
                      }`}
                      autoComplete="off"
                      spellCheck="false"
                      autoFocus
                    />
                    {customModel && (
                      <button
                        type="button"
                        className={styles.clearBtn}
                        onClick={() => {
                          setCustomModel("");
                          setModel("");
                        }}
                        title="Clear model ID"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <div className={styles.customModelHint}>
                    Enter any exact model identifier supported by your {currentProviderMeta.name} endpoint.
                  </div>
                </div>
              )}
            </div>

            {/* Test Connection Row */}
            <div className={styles.testRow}>
              <button
                type="button"
                className={styles.testBtn}
                onClick={handleTestConnection}
                disabled={isTesting || !apiKey.trim()}
              >
                {isTesting ? "⟳ Testing Connection..." : "⚡ Test Key Connection"}
              </button>

              {testResult && (
                <div
                  className={testResult.success ? styles.testStatusOk : styles.testStatusErr}
                >
                  <span>{testResult.success ? "✓" : "✕"}</span>
                  <span>{testResult.message}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={styles.modalFooter}>
          <div className={styles.footerLeft}>
            {hasSavedCustomKey && (
              <button
                type="button"
                className={styles.resetBtn}
                onClick={handleResetToDefault}
              >
                Reset to Server Default Key
              </button>
            )}
          </div>
          <div className={styles.footerRight}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.saveBtn}
              onClick={handleSave}
              disabled={!apiKey.trim()}
            >
              {isRateLimitTriggered ? "💾 Save & Resume Analysis" : "💾 Save Custom Key"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
