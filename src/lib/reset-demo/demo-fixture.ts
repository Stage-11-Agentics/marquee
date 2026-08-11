/**
 * The M-03 minimal demo fixture: one org, one `demo_mode = 1` event, and the
 * two demo personas (organizer, speaker) the one-click demo login looks up.
 * MRQ-14's authoritative seed extends this module; ids are deterministic so a
 * reseed restores the same rows every time.
 *
 * Addresses use the reserved `.example` TLD — no real email addresses in the
 * public repo.
 */

export const DEMO_ORGANIZATION_ID = "org_demo";
export const DEMO_EVENT_ID = "evt_demo";
export const DEMO_ORGANIZER_PERSON_ID = "per_demo_organizer";
export const DEMO_SPEAKER_PERSON_ID = "per_demo_speaker";

export interface DemoFixtureRow {
  statement: string;
  bindings: (number | string | null)[];
}

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
