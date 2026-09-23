/**
 * QA gate kill-switch.
 * When false, every publication/export gate stays advisory: checks still run
 * and surface FAIL/WARN diagnostics for content work, but nothing is blocked.
 * Flip to true to reactivate hard gates (PDF lock, GATE-OVERFLOW, canPublish).
 */
export const QA_GATES_ENABLED = false;

export function qaGatesEnabled(): boolean {
  return QA_GATES_ENABLED;
}
