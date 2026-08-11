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

## Agenda

Export the Agenda as JSON or CSV. Scheduling is an API operation against an accepted Session and requires a room and start time.

\`\`\`sh
node cli/marquee.mjs agenda export "$EVENT_ID" --format csv --url "$MARQUEE_URL" --token "$MARQUEE_TOKEN"
# POST /api/v1/events/{eventId}/submissions/{submissionId}/schedule
curl -fsS -X POST "$MARQUEE_URL/api/v1/events/$EVENT_ID/submissions/$SUBMISSION_ID/schedule" \\
  -H "Authorization: Bearer $MARQUEE_TOKEN" \\
  -H "Content-Type: application/json" \\
  --data '{"starts_at":1760000000000,"duration_min":30,"room_id":"ROOM_ID"}'
\`\`\`

Scheduling changes the working Agenda; check the returned Session before moving on.

## Publish

Publish only after the Session is accepted and scheduled. Publishing is also API-only and returns the updated Session record.

\`\`\`sh
# POST /api/v1/events/{eventId}/submissions/{submissionId}/publish
curl -fsS -X POST "$MARQUEE_URL/api/v1/events/$EVENT_ID/submissions/$SUBMISSION_ID/publish" \\
  -H "Authorization: Bearer $MARQUEE_TOKEN" \\
  -H "Accept: application/json"
\`\`\`

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
