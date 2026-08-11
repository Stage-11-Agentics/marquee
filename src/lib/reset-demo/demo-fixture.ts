import { buildDemoSeedRows } from "./seed-modules";
import {
  EVENT_ID,
  FROZEN_NOW,
  ORG_ID,
  STAFF_PERSON_ID,
} from "../../../scripts/seed/event.ts";

/** Identities used by the shipped full reset seed and route guard. */
export const SHIPPED_DEMO_ORGANIZATION_ID = ORG_ID;
export const SHIPPED_DEMO_EVENT_ID = EVENT_ID;
export const SHIPPED_DEMO_ORGANIZER_PERSON_ID = STAFF_PERSON_ID;
/** First named accepted-core speaker; stable because the source seed is pinned. */
export const SHIPPED_DEMO_SPEAKER_PERSON_ID = "per_aarush-selvan";

/**
 * Legacy seven-row fixture retained for small auth/API contract tests. It is
 * intentionally not used by reseedDemo; production reset always restores the
 * shipped seed above.
 */
export const DEMO_ORGANIZATION_ID = "org_demo";
export const DEMO_EVENT_ID = "evt_demo";
export const DEMO_ORGANIZER_PERSON_ID = "per_demo_organizer";
export const DEMO_SPEAKER_PERSON_ID = "per_demo_speaker";
export const DEMO_SEED_NOW = FROZEN_NOW;

export interface DemoFixtureRow {
  statement: string;
  bindings: (number | string | null)[];
}

/**
 * The complete shipped seed, converted to bound inserts for the one production
 * reseed path. The row order is the seed-module dependency order.
 */
export function shippedDemoFixtureRows(now: number = FROZEN_NOW): DemoFixtureRow[] {
  return buildDemoSeedRows(now).map(({ table, row }) => {
    const columns = Object.keys(row);
    return {
      statement: `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      bindings: columns.map((column) => row[column]!),
    };
  });
}

/** Small fixture for auth/API contract tests; never a production reset source. */
export function demoFixtureRows(now: number): DemoFixtureRow[] {
  return [
    {
      statement:
        "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      bindings: [DEMO_ORGANIZATION_ID, "Marquee Demo", "marquee-demo", now, now],
    },
    {
      statement:
        `INSERT INTO events
          (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, demo_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)`,
      bindings: [
        DEMO_EVENT_ID,
        DEMO_ORGANIZATION_ID,
        "AIE NYC 2026",
        "aie-nyc-2026",
        "The demo conference",
        "2026-10-19",
        "2026-10-21",
        "America/New_York",
        "Javits Center",
        now,
        now,
      ],
    },
    {
      statement:
        `INSERT INTO people
          (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 'marquee', ?, ?)`,
      bindings: [
        DEMO_ORGANIZER_PERSON_ID,
        DEMO_ORGANIZATION_ID,
        "organizer@demo.marquee.example",
        "Demo Organizer",
        now,
        now,
      ],
    },
    {
      statement:
        `INSERT INTO people
          (id, org_id, email, name, is_demo, last_write_source, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 'marquee', ?, ?)`,
      bindings: [
        DEMO_SPEAKER_PERSON_ID,
        DEMO_ORGANIZATION_ID,
        "speaker@demo.marquee.example",
        "Demo Speaker",
        now,
        now,
      ],
    },
    {
      statement:
        `INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'owner', ?, ?)`,
      bindings: [
        "mem_demo_organizer",
        DEMO_ORGANIZATION_ID,
        DEMO_EVENT_ID,
        DEMO_ORGANIZER_PERSON_ID,
        now,
        now,
      ],
    },
    {
      statement:
        `INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
         VALUES (?, ?, NULL, ?, 'owner', ?, ?)`,
      bindings: [
        "mem_demo_organizer_org",
        DEMO_ORGANIZATION_ID,
        DEMO_ORGANIZER_PERSON_ID,
        now,
        now,
      ],
    },
    {
      statement:
        `INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'speaker', ?, ?)`,
      bindings: [
        "mem_demo_speaker",
        DEMO_ORGANIZATION_ID,
        DEMO_EVENT_ID,
        DEMO_SPEAKER_PERSON_ID,
        now,
        now,
      ],
    },
  ];
}
