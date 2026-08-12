#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { COMMAND_REGISTRY } from "./registry.mjs";

const root = resolve(import.meta.dirname, "..");

function commandLines() {
  return COMMAND_REGISTRY
    .map((command) => `- \`node cli/marquee.mjs ${command.usage.replace(/^marquee /, "")}\``)
    .join("\n");
}

export function renderSkill() {
  return `# Marquee

Marquee is a conference operating system. Use its API or CLI as the source of truth for program work; keep each action explicit and inspect the returned state.

## Authentication

Use a scoped API token as a bearer credential. Set \`MARQUEE_URL\` and \`MARQUEE_TOKEN\`, or pass \`--url\` and \`--token\` on every command. Add \`--json\` when another tool will consume the result; successful JSON mode writes exactly one JSON value to stdout.

The command registry is:

${commandLines()}

## Seed

Ensure a seeded conference is available before a walkthrough. If the token already identifies the seeded conference, the command returns it without changing data; otherwise it waits for the reset to finish and returns the event ID.

\`\`\`sh
node cli/marquee.mjs event seed --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
\`\`\`

Use the returned \`event_id\` for later commands. \`event show\` reads the conference, formats, and tracks.

## Triage

The review queue is made of Abstracts and Sessions. Filter on the server, read a record when context is needed, then make an explicit bulk decision.

\`\`\`sh
node cli/marquee.mjs submissions list "$EVENT_ID" --filter status=submitted --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs submissions show "$EVENT_ID" "$SUBMISSION_ID" --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs submissions accept "$EVENT_ID" --filter status=submitted --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
\`\`\`

Use \`reject\` with the same selector when a Session or Abstract should not advance. A filter is resolved by Marquee; the CLI never turns a paginated page into a guessed ID set.

## Chase

Use the Task board to find incomplete speaker work, then send either a stored reminder template or caller-composed text.

\`\`\`sh
node cli/marquee.mjs tasks list "$EVENT_ID" --overdue --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs remind "$EVENT_ID" --filter task_state=open --template task_overdue --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs remind "$EVENT_ID" --filter task_state=open --subject "One detail for your Session" --body "Please complete the open Task in the Portal." --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
\`\`\`

An empty exact selection is a deliberate no-op. Keep recipient selectors narrow and verify the queued count in the response.

## Configure

A conference carries its own name, dates, timezone, and venue, and the tracks and formats every later surface inherits. Read \`event show\` first: it returns the formats and tracks with their IDs, which scheduling needs.

\`\`\`sh
node cli/marquee.mjs event set "$EVENT_ID" --set name="AI Engineer NYC 2026" --set timezone=America/New_York --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs tracks add "$EVENT_ID" --set name=Agents --set color=#3B82F6 --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs formats add "$EVENT_ID" --set name="Lightning" --set default_duration_min=10 --set min_duration_min=5 --set max_duration_min=10 --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
\`\`\`

\`--set\` values parse as JSON when they can, so \`10\` is a number and \`null\` is null. Quote to force a string: \`--set name='"2026"'\`.

## Agenda

Placing a Session needs a room ID and a start time in epoch milliseconds. \`agenda export\` returns the rooms, the placed sessions, and the unscheduled pool; \`search\` turns a talk's name into its ID.

\`\`\`sh
node cli/marquee.mjs search "$EVENT_ID" --query "retrieval" --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs agenda export "$EVENT_ID" --format csv --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN"
node cli/marquee.mjs submissions schedule "$EVENT_ID" "$SUBMISSION_ID" --set starts_at=1760000000000 --set duration_min=30 --set room_id="$ROOM_ID" --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
\`\`\`

Moving or unplacing an item is guarded by that item's version, so two agents cannot silently overwrite each other. The CLI reads the current ETag from the Agenda and sends it; a stale version fails with a conflict rather than clobbering the other write.

\`\`\`sh
node cli/marquee.mjs agenda place "$EVENT_ID" --set submission_id="$SUBMISSION_ID" --set starts_at=1760000000000 --set room_id="$ROOM_ID" --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs agenda move "$EVENT_ID" "$ITEM_ID" --set starts_at=1760003600000 --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs agenda remove "$EVENT_ID" "$ITEM_ID" --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
\`\`\`

Scheduling changes the working Agenda; check the returned Session before moving on.

## Publish

Publish only after the Session is accepted and scheduled — publishing an unscheduled Session is refused.

\`\`\`sh
node cli/marquee.mjs submissions publish "$EVENT_ID" "$SUBMISSION_ID" --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
\`\`\`

The published Session appears on the public program and in the embeddable agenda and speaker widgets.

## Diagnose

When something is wrong, start with the verdict and then read the line behind it. \`diagnose\` probes every binding — database, cache, media, queues, scheduled work — and answers ok or degraded with per-probe timings and the running build.

\`\`\`sh
node cli/marquee.mjs diagnose --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --json
node cli/marquee.mjs diagnose --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN" --bundle
\`\`\`

Every error surface shows a short reference code. It is a prefix of the correlation id on the server's own log lines, so the code an organizer read off the screen is the filter that finds them.

\`\`\`sh
node cli/marquee.mjs logs --tail --request-id 8f2a4c
node cli/marquee.mjs logs --tail --level error
node cli/marquee.mjs logs --tail --event api_error
\`\`\`

Logs are structured, one JSON object per event, built from a field allowlist: they carry route templates, opaque IDs, statuses and timings, and never request bodies, query strings, credentials, or mail addresses. \`GET /health\` is the cheap liveness probe and names the running build.

The product vocabulary is deliberate: Abstract, Session, Evaluation plan, Committee, Portal, Task, and Agenda. Use those nouns when describing work to another operator or agent.
`;
}

const outputPath = resolve(root, "SKILL.md");
const rendered = renderSkill();
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--check")) {
    const current = await readFile(outputPath, "utf8");
    if (current !== rendered) throw new Error("SKILL.md is stale; run node cli/generate-skill.mjs");
  } else {
    await writeFile(outputPath, rendered);
    process.stdout.write("wrote SKILL.md\n");
  }
}
