"use client";
import React from "react";
import styles from "./ProgressTracker.module.css";
import type { GenerationStep, AgentCheckpoint } from "@/types/report";
import { buildProgressSteps, STEP_ORDER, DEFAULT_PROGRESS_TITLE } from "./steps";
import type { PlanProgressTask } from "@/lib/ai-orchestration";

interface ProgressTrackerProps {
  step: GenerationStep;
  message: string;
  progress: number;
  agentCheckpoints?: AgentCheckpoint[];
  supervisorCheckpoints?: AgentCheckpoint[];
  /** Phase 9: selected report type + depth shown beside staged progress. */
  reportContext?: string;
  /** Selected blueprint title — labels steps 03–05 per report type. */
  reportTitle?: string;
  /**
   * Phase B: per-report research task plan (author/checker/red-team/committee
   * from the blueprint outline). When present, the council sub-progress shows
   * these instead of the fixed 7-agent roster.
   */
  planTasks?: PlanProgressTask[];
}

function planTag(task: PlanProgressTask): { cls: string; text: string } | null {
  if (task.status === "complete") return { cls: styles.subTagDone, text: task.kind === "committee" || task.kind === "red-team" ? "REVIEWED ✓" : "COMPLETE ✓" };
  if (task.status === "verifying") return { cls: styles.subTagVerifying, text: task.kind === "checker" || task.kind === "committee" ? "CHECKING..." : "AUDITING..." };
  if (task.status === "retrying") return { cls: styles.subTagRetrying, text: "RETRYING..." };
  if (task.status === "running") return { cls: styles.subTagRunning, text: task.kind === "author" ? "AUTHORING" : task.kind === "red-team" ? "PROBING" : "WORKING" };
  if (task.status === "blocked") return { cls: styles.subTagRetrying, text: "BLOCKED ⚠" };
  if (task.status === "error") return { cls: styles.subTagRetrying, text: "ERROR ⚠" };
  return { cls: styles.subTagPending, text: "QUEUED" };
}

export default function ProgressTracker({
  step,
  message,
  progress,
  agentCheckpoints,
  supervisorCheckpoints,
  reportContext,
  reportTitle = DEFAULT_PROGRESS_TITLE,
  planTasks,
}: ProgressTrackerProps) {
  const currentIndex = STEP_ORDER.indexOf(step);
  const STEPS = buildProgressSteps(reportTitle);
  const showPlan = !!planTasks && planTasks.length > 0;

  return (
    <div className={styles.container}>
      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: `${progress}%` }} />
      </div>
      <div className={styles.progressHeader}>
        <span className={styles.progressStatus}>{message || "Processing..."}</span>
        {reportContext && <span className={styles.progressContext}>{reportContext}</span>}
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

              {s.key === "generating_ai" &&
                (showPlan || (agentCheckpoints && agentCheckpoints.length > 0)) &&
                (isActive || isDone) && (
                <div className={styles.subProgressContainer}>
                  <div className={styles.subProgressHeader}>
                    <div className={styles.subProgressHeaderLeft}>
                      <span className={styles.subProgressPulse} />
                      <span className={styles.subProgressTitle}>
                        {showPlan
                          ? `RESEARCH TASK PLAN · ${reportTitle.toUpperCase()}`
                          : `AI ANALYST COUNCIL · ${reportTitle.toUpperCase()}`}
                      </span>
                    </div>
                    <span className={styles.subProgressBadge}>
                      {showPlan
                        ? `${planTasks!.filter((t) => t.status === "complete").length} / ${planTasks!.length} READY`
                        : `${agentCheckpoints!.filter((c) => c.status === "complete").length} / ${agentCheckpoints!.length} READY`}
                    </span>
                  </div>

                  <div className={styles.subSteps}>
                    {showPlan
                      ? planTasks!.map((task, taskIdx) => {
                          const tag = planTag(task);
                          const isActiveTask =
                            task.status === "running" ||
                            task.status === "verifying" ||
                            task.status === "retrying";
                          return (
                            <div
                              key={task.id}
                              className={`${styles.subStep} ${task.status === "complete" ? styles.subStepDone : ""} ${isActiveTask ? styles.subStepActive : ""} ${task.status === "pending" ? styles.subStepPending : ""} ${task.status === "blocked" ? styles.subStepRetrying : ""}`}
                            >
                              <div className={styles.subStepLeft}>
                                <div className={styles.subStepIndex}>
                                  {task.status === "complete" ? (
                                    <span className={styles.subCheck}>✓</span>
                                  ) : isActiveTask ? (
                                    <span className={styles.subSpinner}>⟳</span>
                                  ) : (
                                    String(taskIdx + 1).padStart(2, "0")
                                  )}
                                </div>
                                <div className={styles.subStepText}>
                                  <span className={styles.subStepName}>{task.name}</span>
                                  <span className={styles.subStepRole}>{task.role}</span>
                                  {task.note && (
                                    <span className={styles.subStepAuditNote}>{task.note}</span>
                                  )}
                                </div>
                              </div>
                              <div className={styles.subStepStatus}>
                                {tag && (
                                  <span className={`${styles.subStepTag} ${tag.cls}`}>{tag.text}</span>
                                )}
                              </div>
                            </div>
                          );
                        })
                      : agentCheckpoints!.map((agent, agentIdx) => {
                      const isAgentDone = agent.status === "complete";
                      const isAgentVerifying = agent.status === "verifying";
                      const isAgentRunning = agent.status === "running";
                      const isAgentPending = agent.status === "pending";
                      const isAgentRetrying = agent.status === "retrying";

                      return (
                        <div
                          key={agent.id}
                          className={`${styles.subStep} ${isAgentDone ? styles.subStepDone : ""} ${isAgentVerifying || isAgentRunning ? styles.subStepActive : ""} ${isAgentPending ? styles.subStepPending : ""} ${isAgentRetrying ? styles.subStepRetrying : ""}`}
                        >
                          <div className={styles.subStepLeft}>
                            <div className={styles.subStepIndex}>
                              {isAgentDone ? (
                                <span className={styles.subCheck}>✓</span>
                              ) : isAgentVerifying || isAgentRunning ? (
                                <span className={styles.subSpinner}>⟳</span>
                              ) : isAgentRetrying ? (
                                <span className={styles.subSpinner}>↻</span>
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
                                  {agent.id === "verifier" ? (
                                    agent.retryRound && agent.retryRound > 0
                                      ? `AUDIT PASSED ✓ (R${agent.retryRound})`
                                      : "AUDIT DONE ✓"
                                  ) : "COMPLETE ✓"}
                                </span>
                              )}
                            {isAgentVerifying && (
                              <span className={`${styles.subStepTag} ${styles.subTagVerifying}`}>
                                COUNCIL AUDITING...
                              </span>
                            )}
                            {isAgentRetrying && (
                              <span className={`${styles.subStepTag} ${styles.subTagRetrying}`}>
                                RETRYING ROUND {agent.retryRound || 1}...
                              </span>
                            )}
                            {isAgentRunning && !isAgentVerifying && !isAgentRetrying && (
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

              {s.key === "calculating" && supervisorCheckpoints && supervisorCheckpoints.length > 0 && (isActive || isDone) && (
                <div className={styles.subProgressContainer}>
                  <div className={styles.subProgressHeader}>
                    <div className={styles.subProgressHeaderLeft}>
                      <span className={styles.subProgressPulse} />
                      <span className={styles.subProgressTitle}>AI FINANCIAL SUPERVISOR</span>
                    </div>
                    <span className={styles.subProgressBadge}>
                      {supervisorCheckpoints.filter((c) => c.status === "complete").length} / {supervisorCheckpoints.length} AUDITED
                    </span>
                  </div>

                  <div className={styles.subSteps}>
                    {supervisorCheckpoints.map((chk, chkIdx) => {
                      const isDone_ = chk.status === "complete";
                      const isRunning_ = chk.status === "running" || chk.status === "verifying";
                      const isPending_ = chk.status === "pending";

                      return (
                        <div
                          key={chk.id}
                          className={`${styles.subStep} ${isDone_ ? styles.subStepDone : ""} ${isRunning_ ? styles.subStepActive : ""} ${isPending_ ? styles.subStepPending : ""}`}
                        >
                          <div className={styles.subStepLeft}>
                            <div className={styles.subStepIndex}>
                              {isDone_ ? (
                                <span className={styles.subCheck}>✓</span>
                              ) : isRunning_ ? (
                                <span className={styles.subSpinner}>⟳</span>
                              ) : (
                                `0${chkIdx + 1}`
                              )}
                            </div>
                            <div className={styles.subStepText}>
                              <span className={styles.subStepName}>{chk.name}</span>
                              <span className={styles.subStepRole}>{chk.role}</span>
                              {chk.councilAuditNote && (
                                <span className={styles.subStepAuditNote}>{chk.councilAuditNote}</span>
                              )}
                            </div>
                          </div>

                          <div className={styles.subStepStatus}>
                            {isDone_ && (
                              <span className={`${styles.subStepTag} ${styles.subTagDone}`}>AUDITED ✓</span>
                            )}
                            {isRunning_ && (
                              <span className={`${styles.subStepTag} ${styles.subTagRunning}`}>SUPERVISING</span>
                            )}
                            {isPending_ && <span className={`${styles.subStepTag} ${styles.subTagPending}`}>QUEUED</span>}
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
