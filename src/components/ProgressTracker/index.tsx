"use client";
import React from "react";
import styles from "./ProgressTracker.module.css";
import type { GenerationStep, AgentCheckpoint } from "@/types/report";

const STEPS: { key: GenerationStep; label: string; index: string }[] = [
  { key: "fetching_data", label: "Querying Yahoo Finance Market Data", index: "01" },
  { key: "calculating", label: "Computing Financial Ratios & DCF Model", index: "02" },
  { key: "generating_ai", label: "Structuring Institutional Equity Thesis", index: "03" },
  { key: "building_pdf", label: "Assembling Publication Dossier", index: "04" },
  { key: "done", label: "Research Model Active", index: "05" },
];

const STEP_ORDER: GenerationStep[] = ["fetching_data", "calculating", "generating_ai", "building_pdf", "done"];

interface ProgressTrackerProps {
  step: GenerationStep;
  message: string;
  progress: number;
  agentCheckpoints?: AgentCheckpoint[];
}

export default function ProgressTracker({
  step,
  message,
  progress,
  agentCheckpoints,
}: ProgressTrackerProps) {
  const currentIndex = STEP_ORDER.indexOf(step);

  return (
    <div className={styles.container}>
      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: `${progress}%` }} />
      </div>
      <div className={styles.progressHeader}>
        <span className={styles.progressStatus}>{message || "Processing..."}</span>
        <span className={styles.progressPercent}>{Math.round(progress)}%</span>
      </div>

      <div className={styles.steps}>
        {STEPS.map((s) => {
          const idx = STEP_ORDER.indexOf(s.key);
          const isDone = currentIndex > idx;
          const isActive = currentIndex === idx;
          const isPending = currentIndex < idx;

          return (
            <div key={s.key} className={styles.stepWrapper}>
              <div
                className={`${styles.step} ${isDone ? styles.stepDone : ""} ${isActive ? styles.stepActive : ""} ${isPending ? styles.stepPending : ""}`}
              >
                <div className={styles.stepIndex}>
                  {isDone ? "✓" : isActive ? (
                    <span className={styles.spinner}>⟳</span>
                  ) : s.index}
                </div>
                <span className={styles.stepLabel}>{s.label}</span>
                {isActive && <span className={styles.liveTag}>RUNNING</span>}
                {isDone && <span className={styles.doneTag}>COMPLETE</span>}
              </div>

              {s.key === "generating_ai" && agentCheckpoints && agentCheckpoints.length > 0 && (isActive || isDone) && (
                <div className={styles.subProgressContainer}>
                  <div className={styles.subProgressHeader}>
                    <div className={styles.subProgressHeaderLeft}>
                      <span className={styles.subProgressPulse} />
                      <span className={styles.subProgressTitle}>AI ANALYST COUNCIL CHECKPOINTS</span>
                    </div>
                    <span className={styles.subProgressBadge}>
                      {agentCheckpoints.filter((c) => c.status === "complete").length} / {agentCheckpoints.length} READY
                    </span>
                  </div>

                  <div className={styles.subSteps}>
                    {agentCheckpoints.map((agent, agentIdx) => {
                      const isAgentDone = agent.status === "complete";
                      const isAgentVerifying = agent.status === "verifying";
                      const isAgentRunning = agent.status === "running";
                      const isAgentPending = agent.status === "pending";

                      return (
                        <div
                          key={agent.id}
                          className={`${styles.subStep} ${isAgentDone ? styles.subStepDone : ""} ${isAgentVerifying || isAgentRunning ? styles.subStepActive : ""} ${isAgentPending ? styles.subStepPending : ""}`}
                        >
                          <div className={styles.subStepLeft}>
                            <div className={styles.subStepIndex}>
                              {isAgentDone ? (
                                <span className={styles.subCheck}>✓</span>
                              ) : isAgentVerifying || isAgentRunning ? (
                                <span className={styles.subSpinner}>⟳</span>
                              ) : (
                                `0${agentIdx + 1}`
                              )}
                            </div>
                            <div className={styles.subStepText}>
                              <span className={styles.subStepName}>{agent.name}</span>
                              <span className={styles.subStepRole}>{agent.role}</span>
                              {agent.councilAuditNote && (
                                <span className={styles.subStepAuditNote}>{agent.councilAuditNote}</span>
                              )}
                            </div>
                          </div>

                          <div className={styles.subStepStatus}>
                            {isAgentDone && (
                              <span className={`${styles.subStepTag} ${styles.subTagDone}`}>
                                {agent.id === "verifier" ? "COUNCIL CERTIFIED ✓" : "COUNCIL VERIFIED ✓"}
                              </span>
                            )}
                            {isAgentVerifying && (
                              <span className={`${styles.subStepTag} ${styles.subTagVerifying}`}>
                                COUNCIL AUDITING...
                              </span>
                            )}
                            {isAgentRunning && !isAgentVerifying && (
                              <span className={`${styles.subStepTag} ${styles.subTagRunning}`}>
                                {agent.id === "verifier" ? "AUDITING LIVE" : "ANALYZING"}
                              </span>
                            )}
                            {isAgentPending && <span className={`${styles.subStepTag} ${styles.subTagPending}`}>QUEUED</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
