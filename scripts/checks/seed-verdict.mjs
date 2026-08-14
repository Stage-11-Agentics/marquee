export const SEED_BUDGET_MS = 30_000;
// Keep the hard limit well clear of the objective. This follows run-test.mjs's
// 13x ratio: the objective measures speed, while the limit only catches a hang.
export const SEED_HARD_LIMIT_MS = SEED_BUDGET_MS * 13;

export function classifySeedRun({ elapsedMs, budgetMs = SEED_BUDGET_MS, timedOut = false, exitCode = 0 }) {
  const overBudget = elapsedMs > budgetMs;
  const status = timedOut
    ? "timeout"
    : exitCode !== 0
      ? "fail"
      : overBudget
        ? "pass-over-budget"
        : "pass";
  const verdict = timedOut
    ? "timeout"
    : exitCode !== 0
      ? "fail"
      : overBudget
        ? "warn"
        : "pass";
  return { status, verdict, overBudget };
}

export function exitCodeForSeedStatus(status) {
  return status === "fail" || status === "timeout" ? 1 : 0;
}

/**
 * Race a check against its hang detector. The task is intentionally not
 * cancelled: the caller owns cleanup and must terminate the process if a
 * timeout is returned, so child processes cannot keep a failed check alive.
 */
export async function runWithHardLimit(task, { hardLimitMs = SEED_HARD_LIMIT_MS } = {}) {
  const startedAt = performance.now();
  let timeoutId;
  const taskResult = Promise.resolve().then(task).then(
    (value) => ({ timedOut: false, value }),
    (error) => Promise.reject(error),
  );
  const timeoutResult = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve({ timedOut: true }), hardLimitMs);
  });
  const outcome = await Promise.race([taskResult, timeoutResult]);
  clearTimeout(timeoutId);
  return {
    ...outcome,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
}
