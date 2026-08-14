/** MRQ-205: organization-level Outreach cards aimed at more than one conference. */

import { seedId, syntheticEmail } from "../../src/lib/ids.ts";
import type { SeedContext, SeedModule } from "./_sql.ts";
import { EVENT_ID, ORG_ID, OUTREACH_EVENT_ID, STAFF_PERSON_ID } from "./event.ts";

const MARGARETHE_ID = seedId("per", "outreach-margarethe-von-habsburg-lothringen");

function firstPersonId(ctx: SeedContext): string {
  const row = ctx.rows.find((entry) => entry.table === "people" && entry.row.id !== STAFF_PERSON_ID);
  return String(row?.row.id ?? "per_aarush-selvan");
}

export function run(ctx: SeedContext): void {
  ctx.add("people", {
    id: MARGARETHE_ID,
    org_id: ORG_ID,
    email: syntheticEmail("Margarethe von Habsburg-Lothringen", new Set()),
    name: "Margarethe von Habsburg-Lothringen",
    title: "Infrastructure Historian",
    company: "Longform Signal Cooperative",
    bio: "Synthetic long-name fixture for the Outreach card and drawer layout.",
    headshot_attachment_id: null,
    social_links: "[]",
    is_demo: 1,
    last_write_source: "marquee",
    created_at: ctx.now,
    updated_at: ctx.now,
  });

  const cards = [
    {
      id: seedId("pev", "outreach-margarethe-devflow"),
      person_id: MARGARETHE_ID,
      target_event_id: OUTREACH_EVENT_ID,
      stage: "contacted",
      next_touch_on: "2026-08-18",
      rationale: "Her infrastructure history would make a useful DevFlow conversation.",
    },
    {
      id: seedId("pev", "outreach-first-speaker-aie"),
      person_id: firstPersonId(ctx),
      target_event_id: EVENT_ID,
      stage: "identified",
      next_touch_on: "2026-08-27",
      rationale: "Returning speaker with a strong fit for the current program.",
    },
  ];

  for (const card of cards) {
    ctx.add("person_events", {
      id: card.id,
      org_id: ORG_ID,
      person_id: card.person_id,
      kind: "stage",
      value_json: JSON.stringify({ stage: card.stage, rationale: card.rationale }),
      actor_person_id: STAFF_PERSON_ID,
      target_event_id: card.target_event_id,
      next_touch_on: card.next_touch_on,
      created_at: ctx.now,
    });
  }
}

export const seed: SeedModule = { name: "outreach", order: 70, run };
