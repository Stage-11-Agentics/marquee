/** One walkable helper seat on the shipped conference. */

import { seedId } from "../../src/lib/ids.ts";
import type { SeedContext, SeedModule } from "./_sql.ts";
import { EVENT_ID, ORG_ID } from "./event.ts";

const SPEAKER_PERSON_ID = "per_aarush-selvan";
const HELPER_PERSON_ID = seedId("per", "demo-speaker-helper");

export function run(ctx: SeedContext): void {
  const { now } = ctx;
  ctx.add("people", {
    id: HELPER_PERSON_ID,
    org_id: ORG_ID,
    email: "demo.helper@example.com",
    name: "Jordan Vale",
    title: "Executive assistant",
    company: "Demo Conference",
    bio: null,
    headshot_attachment_id: null,
    social_links: "[]",
    is_demo: 1,
    last_write_source: "marquee",
    created_at: now,
    updated_at: now,
  });
  ctx.add("speaker_helpers", {
    id: seedId("shp", "aarush-selvan-demo-helper"),
    event_id: EVENT_ID,
    speaker_person_id: SPEAKER_PERSON_ID,
    helper_person_id: HELPER_PERSON_ID,
    helper_name: "Jordan Vale",
    added_by: SPEAKER_PERSON_ID,
    added_at: now,
    removed_at: null,
  });
}

export const seed: SeedModule = { name: "helpers", order: 25, run };
