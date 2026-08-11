/**
 * The demo reset, as the sidebar's reset control drives it.
 *
 * The admin shell runs the same sequence inline. Both should collapse onto this
 * helper the next time that file is opened for another reason; until then this
 * is a faithful copy rather than a second behaviour, so the control does the
 * same thing on every screen that renders the sidebar.
 */

type ResetResponse = {
  job_id?: unknown;
  status?: unknown;
  error?: { message?: unknown };
};

const RESET_DEADLINE_MS = 20_000;
const RESET_POLL_MS = 250;

function resetError(body: ResetResponse | null, fallback: string): Error {
  const message = body?.error?.message;
  return new Error(typeof message === "string" && message.length > 0 ? message : fallback);
}

/** Runs the reset to completion, reporting each stage through `report`. Resolves true when the demo was rebuilt. */
export async function runDemoReset(report: (message: string) => void): Promise<boolean> {
  report("Resetting demo…");
  try {
    const response = await fetch("/api/v1/admin/reset-demo", {
      method: "POST",
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    const body = await response.json().catch(() => null) as ResetResponse | null;
    if (!response.ok) throw resetError(body, "Reset request failed");
    if (typeof body?.job_id !== "string" || body.job_id.length === 0) {
      throw new Error("Reset request returned no job id");
    }

    const deadline = Date.now() + RESET_DEADLINE_MS;
    let status = typeof body.status === "string" ? body.status : "queued";
    let job: ResetResponse | null = body;
    while (status !== "done" && Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, RESET_POLL_MS));
      const statusResponse = await fetch(
        "/api/v1/admin/reset-demo/" + encodeURIComponent(body.job_id),
        { headers: { accept: "application/json" }, cache: "no-store" },
      );
      job = await statusResponse.json().catch(() => null) as ResetResponse | null;
      if (!statusResponse.ok) throw resetError(job, "Reset status could not be read");
      status = typeof job?.status === "string" ? job.status : "unknown";
      if (status === "failed") throw resetError(job, "The demo reset job failed");
    }
    if (status !== "done") throw new Error("The demo reset timed out after 20 seconds");

    report("Demo reset complete. Reloading…");
    return true;
  } catch (error) {
    report("Reset failed: " + (error instanceof Error ? error.message : String(error)));
    return false;
  }
}
