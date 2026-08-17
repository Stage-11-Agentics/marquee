/**
 * MRQ-277 D1 — the defect that took the call for papers apart in eval round 15.
 *
 * A submitter chose an Audience level, saved a draft, and the field came back
 * empty. Every other answer survived, including the *required* Format select,
 * so the shape looked like "optional answers are dropped" — and then Submit
 * refused on the field the form's own label calls optional, blaming the
 * submitter for an answer the product had thrown away.
 *
 * The asymmetry was never optional-versus-required. Audience level is the one
 * select bound to Conference levels, and a levels answer is stored in BOTH
 * columns: `value_text` holds the chosen label, `value_json` holds
 * `{ bound_source, id, label }` so routing can resolve the level row. Every
 * reader reached for the JSON first, handed a `<select>` an object, and a
 * select renders an object as no answer at all. The same stale object then went
 * back on Submit, where a single-select that is not a string is not a valid
 * choice — which is the refusal the submitter saw.
 *
 * So this covers both halves against the real HTTP surface: the answer survives
 * the round trip, and nothing about the optional field is enforced at submit.
 */
import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { applyMigrations, env } from "../apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const NOW = Date.UTC(2026, 7, 17, 12, 0, 0);
const ORG_ID = "org_mrq277";
const EVENT_ID = "evt_mrq277";
const FORM_ID = "form_mrq277";
const SLUG = "mrq277-cfp";

interface PublicFormState {
  answers: Record<string, unknown>;
  resume_token: string | null;
  state: string;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

function field(id: string, key: string, label: string, type: string, required: number, position: number, config: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO form_fields (id, form_id, key, label, help_text, type, required, position, config, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, FORM_ID, key, label, type, required, position, config, NOW, NOW);
}

async function seedFixture(): Promise<void> {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(ORG_ID, "MRQ-277", "mrq-277", NOW, NOW),
    // demo_mode = 1 so the public path is Turnstile-exempt, exactly as the
    // graded conference is.
    env.DB.prepare(`INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, accent, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, 'Round 15 Conference', 'mrq-277-conference', 'Ship it', '2027-03-01', '2027-03-03', 'America/New_York', 'Somewhere', '#0b6a72', 'live', 1, ?, ?)`)
      .bind(EVENT_ID, ORG_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO formats (id, event_id, name, default_duration_min, min_duration_min, max_duration_min, position, created_at, updated_at) VALUES (?, ?, 'Stage Talk', 20, 10, 40, 0, ?, ?)")
      .bind("fmt_mrq277", EVENT_ID, NOW, NOW),
    env.DB.prepare("INSERT INTO levels (id, event_id, name, name_key, position, created_at, updated_at) VALUES (?, ?, 'Introductory', 'introductory', 0, ?, ?), (?, ?, 'Advanced', 'advanced', 1, ?, ?)")
      .bind("lvl_mrq277_intro", EVENT_ID, NOW, NOW, "lvl_mrq277_adv", EVENT_ID, NOW, NOW),
    env.DB.prepare(`INSERT INTO forms (id, event_id, name, slug, kind, status, opens_at, closes_at, min_speakers, max_speakers, submitter_limit_inherit, created_at, updated_at)
      VALUES (?, ?, 'Call for Speakers', ?, 'abstract', 'open', NULL, NULL, 1, 1, 1, ?, ?)`)
      .bind(FORM_ID, EVENT_ID, SLUG, NOW, NOW),
    field("fld_mrq277_title", "title", "Session title", "short_text", 1, 0, "{}"),
    field("fld_mrq277_name", "speaker_name", "Primary speaker name", "short_text", 1, 1, "{}"),
    field("fld_mrq277_email", "speaker_email", "Primary speaker email", "email", 1, 2, "{}"),
    // Required and bound: this one always survived, and is the control.
    field("fld_mrq277_format", "format", "Format", "single_select", 1, 3, JSON.stringify({ source: "formats" })),
    // Optional and bound to levels: the answer that vanished.
    field("fld_mrq277_level", "audience_level", "Audience level", "single_select", 0, 4, JSON.stringify({ source: "levels" })),
  ]);
}

const ANSWERS = {
  title: "Taming flaky CI at scale",
  speaker_name: "Wren Halloway",
  speaker_email: "wren@mrq277.test",
  format: "Stage Talk",
  audience_level: "Introductory",
};

describe.sequential("MRQ-277 D1 · a bound optional select survives the public form", () => {
  beforeAll(seedFixture, 20_000);

  test("CONTRACT · MRQ-277 · a draft round-trip returns the optional level as the chosen label", async () => {
    const created = await request(`/api/v1/public/forms/${SLUG}/drafts`, {
      method: "POST",
      body: JSON.stringify({ answers: ANSWERS, email: ANSWERS.speaker_email }),
    });
    expect(created.status).toBe(201);
    const draft = await created.json<PublicFormState>();

    // The echo the form re-renders from. An object here is a blank select.
    expect(draft.answers.audience_level).toBe("Introductory");
    expect(draft.answers.format).toBe("Stage Talk");
    expect(typeof draft.answers.audience_level).toBe("string");

    // Both columns are still written — the level id is what routing resolves —
    // so this is a reading fault, and the fix must not cost the id.
    const stored = await env.DB.prepare(
      "SELECT value_text, value_json FROM submission_answers WHERE field_id = 'fld_mrq277_level'",
    ).first<{ value_text: string | null; value_json: string | null }>();
    expect(stored?.value_text).toBe("Introductory");
    expect(JSON.parse(stored?.value_json ?? "null")).toMatchObject({ bound_source: "levels", id: "lvl_mrq277_intro" });

    // And again through a full reload of the saved draft, which is the path the
    // submitter takes from the resume link in their email.
    const resumed = await request(`/api/v1/public/forms/${SLUG}?resume=${encodeURIComponent(draft.resume_token ?? "")}`);
    expect(resumed.status).toBe(200);
    const reloaded = await resumed.json<PublicFormState>();
    expect(reloaded.state).toBe("resumed");
    expect(reloaded.answers.audience_level).toBe("Introductory");
  });

  test("CONTRACT · MRQ-277 · an optional field is never enforced at submit, answered or blank", async () => {
    const created = await request(`/api/v1/public/forms/${SLUG}/drafts`, {
      method: "POST",
      body: JSON.stringify({ answers: ANSWERS, email: ANSWERS.speaker_email }),
    });
    expect(created.status).toBe(201);
    const draft = await created.json<PublicFormState>();

    // Submit carrying exactly what the form would now render — the label, not
    // the descriptor — and it goes through.
    const submitted = await request(`/api/v1/public/forms/${SLUG}/submissions`, {
      method: "POST",
      body: JSON.stringify({ answers: draft.answers, email: ANSWERS.speaker_email, resumeToken: draft.resume_token }),
    });
    expect(submitted.status).toBe(201);
    expect((await submitted.json<PublicFormState>()).state).toBe("submitted");

    // And an optional select left blank is not a reason to refuse either.
    const { audience_level: _omitted, ...withoutLevel } = ANSWERS;
    const blankDraft = await request(`/api/v1/public/forms/${SLUG}/drafts`, {
      method: "POST",
      body: JSON.stringify({ answers: { ...withoutLevel, speaker_email: "second@mrq277.test" }, email: "second@mrq277.test" }),
    });
    expect(blankDraft.status).toBe(201);
    const blank = await blankDraft.json<PublicFormState>();
    const blankSubmit = await request(`/api/v1/public/forms/${SLUG}/submissions`, {
      method: "POST",
      body: JSON.stringify({
        answers: { ...blank.answers, audience_level: "" },
        email: "second@mrq277.test",
        resumeToken: blank.resume_token,
      }),
    });
    expect(blankSubmit.status).toBe(201);
  });
});
