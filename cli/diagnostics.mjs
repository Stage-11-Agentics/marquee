/**
 * `marquee diagnose` and `marquee logs --tail`.
 *
 * The pair exists so that "is it broken, and where" and "show me the line
 * behind this reference code" are each one command, for a human at a terminal
 * and for an agent driving the same surface. An organizer who can paste six
 * characters into `marquee logs --tail --request-id 8f2a4c` does not need
 * anyone to read a dashboard for them.
 */

const LEVEL_RANK = { debug: 10, info: 20, warn: 30, error: 40 };

/** Does one of our structured lines pass the caller's filters? */
export function matchesFilters(line, filters) {
  if (filters.event && line.event !== filters.event) return false;
  if (filters.level) {
    const threshold = LEVEL_RANK[filters.level];
    if (threshold === undefined) return false;
    if ((LEVEL_RANK[line.level] ?? 0) < threshold) return false;
  }
  if (filters.requestId) {
    // A reference code shown on screen is a PREFIX of the correlation id, so
    // the six characters an organizer read aloud are enough to match.
    const id = String(line.request_id ?? "").replaceAll("-", "").toLowerCase();
    if (!id.startsWith(filters.requestId.replaceAll("-", "").toLowerCase())) return false;
  }
  return true;
}

/**
 * Pull our JSON lines out of one wrangler tail event. Wrangler wraps each
 * console call in its own envelope; anything that is not one of our lines is
 * dropped rather than printed, because the point of the command is signal.
 */
export function structuredLinesFrom(tailEvent) {
  const found = [];
  for (const entry of tailEvent?.logs ?? []) {
    for (const part of entry?.message ?? []) {
      if (typeof part !== "string" || !part.startsWith("{")) continue;
      try {
        const parsed = JSON.parse(part);
        if (typeof parsed?.event === "string" && typeof parsed?.schema_version === "number") {
          found.push(parsed);
        }
      } catch {
        // Not one of ours.
      }
    }
  }
  return found;
}

/** One readable line per event, with the correlation id kept first-class. */
export function formatLine(line) {
  const id = line.request_id ? ` ${String(line.request_id).slice(0, 8)}` : "";
  const detail = [
    line.method && line.route ? `${line.method} ${line.route}` : line.route,
    line.cron,
    line.queue && line.message_type ? `${line.queue}/${line.message_type}` : undefined,
    line.status,
    line.duration_ms === undefined ? undefined : `${line.duration_ms}ms`,
    line.d1_queries === undefined ? undefined : `${line.d1_queries}q`,
    line.code,
    line.message,
  ]
    .filter((part) => part !== undefined && part !== "")
    .join(" ");
  return `${line.ts} ${String(line.level).toUpperCase().padEnd(5)}${id} ${line.event} ${detail}`.trimEnd();
}

/**
 * Follow the live stream. This shells out to the platform's own tail rather
 * than inventing a log store: the logs belong to the operator's account, and
 * this command is a reader, not a second copy of them.
 */
export async function tailLogs(filters, { spawnImpl, stdout = process.stdout } = {}) {
  const { spawn } = spawnImpl ? { spawn: spawnImpl } : await import("node:child_process");
  const child = spawn("npx", ["wrangler", "tail", "--format", "json"], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  let buffered = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffered += chunk;
    const parts = buffered.split("\n");
    buffered = parts.pop() ?? "";
    for (const part of parts) {
      if (!part.trim()) continue;
      let event;
      try {
        event = JSON.parse(part);
      } catch {
        continue;
      }
      for (const line of structuredLinesFrom(event)) {
        if (matchesFilters(line, filters)) stdout.write(`${formatLine(line)}\n`);
      }
    }
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new Error(`wrangler tail exited with code ${code}`));
    });
  });
}

/**
 * The server-side twin of the browser's "Copy diagnostic report": everything an
 * engineer needs about this deployment, in one paste, with nothing an organizer
 * would be uncomfortable posting in public.
 */
export function renderDiagnosticBundle(diagnostics, at = new Date()) {
  const probe = (each) =>
    `- ${each.name}: ${each.ok ? "ok" : "FAILED"} (${each.duration_ms}ms)${each.detail ? ` — ${each.detail}` : ""}`;
  const cron = (each) =>
    `- ${each.cron}: ${each.last_success_at === 0 ? "never run" : `${Math.round(each.age_ms / 60_000)} min ago`}${each.stale ? " — STALE" : ""}`;
  return [
    "### Marquee diagnostic report",
    "",
    `- Verdict: **${diagnostics.status}**`,
    `- Build: \`${diagnostics.build?.sha ?? "unknown"}\` built ${diagnostics.build?.built_at ?? "unknown"}`,
    `- Migration: \`${diagnostics.migration}\``,
    `- Checked: ${diagnostics.checked_at ?? at.toISOString()}`,
    "",
    "**Bindings**",
    "",
    ...(diagnostics.probes ?? []).map(probe),
    "",
    "**Scheduled work**",
    "",
    ...((diagnostics.crons ?? []).length > 0 ? diagnostics.crons.map(cron) : ["- (no triggers reported)"]),
  ].join("\n");
}
