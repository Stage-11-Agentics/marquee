import { parseArguments } from "./checks/lib/command.mjs";

const args = parseArguments();
const baseUrl = args.url ?? "https://localhost:8787";
const localValidationToken = process.env.LOCAL_VALIDATION_TOKEN;
const pollIntervalMs = 500;
const pollTimeoutMs = 20_000;

if (!localValidationToken) {
  console.error(
    "LOCAL_VALIDATION_TOKEN is not set — reset:demo authenticates via the loopback-only " +
      "x-marquee-local-validation header locally; set it in .dev.vars (see BUILDPLAN §7). " +
      "Remote invocation auth is deferred to MRQ-57.",
  );
  process.exit(1);
}

async function main() {
  const startedAt = Date.now();
  const response = await fetch(new URL("/api/v1/admin/reset-demo", baseUrl), {
    method: "POST",
    headers: { "x-marquee-local-validation": localValidationToken },
  });
  if (!response.ok) {
    console.error(`reset-demo POST failed: ${response.status} ${await response.text()}`);
    process.exit(1);
  }
  const { job_id: jobId } = await response.json();
  console.log(`reset-demo job ${jobId} queued`);

  while (Date.now() - startedAt < pollTimeoutMs) {
    const poll = await fetch(new URL(`/api/v1/admin/reset-demo/${jobId}`, baseUrl));
    if (poll.ok) {
      const job = await poll.json();
      if (job.status === "done") {
        console.log(`reset-demo done in ${Date.now() - startedAt}ms`);
        return;
      }
      if (job.status === "failed") {
        console.error(`reset-demo failed: ${job.error ?? "unknown error"}`);
        process.exit(1);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  console.error(`reset-demo job ${jobId} did not complete within ${pollTimeoutMs}ms`);
  process.exit(1);
}

await main();
