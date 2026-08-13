import { expect, test } from "vitest";

import { app, type Env } from "../../src/index";
import { applyMigrations, env } from "./apply-migrations";

/**
 * Pressing Save draft creates a submission row server-side, and so does
 * attaching a file. When those rows counted against "Submissions per person"
 * the cap became self-inflicting: three presses on a three-abstract form locked
 * the address out of drafting, attaching, and submitting — permanently, without
 * a single abstract reaching the committee.
 */
const SHELL = `<!doctype html><html><head><title>Marquee</title></head><body><div id="app"></div></body></html>`;
const assets = { fetch: async () => new Response(SHELL, { headers: { "content-type": "text/html" } }) } as unknown as Fetcher;
const ORG = "org_draft_limit";
const EVENT = "evt_draft_limit";
const FORM = "frm_draft_limit";
const SLUG = "draft-limit-cfp";
const EMAIL = "repeat.drafter@example.com";
const NOW = Date.UTC(2026, 7, 12, 12, 0, 0);
const LIMIT = 3;

function runtimeEnv(): Env {
  return { ...env, ASSETS: assets } as unknown as Env;
}

async function seed(): Promise<void> {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(ORG, "Draft Limit Org", "draft-limit-org", NOW, NOW),
    env.DB.prepare("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)")
      .bind(EVENT, ORG, "Draft Limit Conference", "draft-limit-conference", "2026-10-12", "2026-10-14", "America/New_York", NOW, NOW),
    env.DB.prepare(`INSERT INTO forms
      (id, event_id, name, slug, kind, status, opens_at, closes_at, welcome_md,
       per_submitter_limit, min_speakers, max_speakers, max_sponsors,
       admin_notify_person_ids, turnstile_required, created_at, updated_at)
      VALUES (?, ?, 'Draft Limit CFP', ?, 'abstract', 'open', ?, ?, '', ?, 1, 4, 0, '[]', 0, ?, ?)`)
      .bind(FORM, EVENT, SLUG, 0, Date.UTC(2099, 0, 1), LIMIT, NOW, NOW),
    env.DB.prepare(`INSERT INTO form_fields
      (id, form_id, key, label, help_text, type, required, position, config, condition, created_at, updated_at)
      VALUES
      ('fld_dl_title', ?, 'title', 'Session title', NULL, 'short_text', 1, 0, '{}', NULL, ?, ?),
      ('fld_dl_email', ?, 'speaker_email', 'Primary speaker email', NULL, 'email', 1, 1, '{}', NULL, ?, ?)`)
      .bind(FORM, NOW, NOW, FORM, NOW, NOW),
  ]);
}

async function saveDraft(title: string): Promise<Response> {
  return app.request(
    `/api/v1/public/forms/${SLUG}/drafts`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: { title, speaker_email: EMAIL }, email: EMAIL }),
    },
    runtimeEnv(),
  );
}

test("CONTRACT · saving a draft repeatedly never exhausts the abstract allowance", async () => {
  await seed();

  // Two presses past the form's own limit of three.
  for (const attempt of [1, 2, 3, 4, 5]) {
    const response = await saveDraft(`Draft attempt ${attempt}`);
    expect(response.status, `Save draft #${attempt} should be accepted`).toBe(201);
  }

  // And the form still reads open to that address rather than at_limit, which
  // is what turned the 409 into a permanent lockout on the deployed build.
  const form = await app.request(`/api/v1/public/forms/${SLUG}?email=${encodeURIComponent(EMAIL)}`, {}, runtimeEnv());
  const state = await form.json<{ state: string }>();
  expect(state.state).not.toBe("at_limit");

  // The cap itself still exists — it counts abstracts in front of the
  // committee, which is what "Submissions per person" means.
  const submitted = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM submissions WHERE form_id = ? AND status = 'draft'",
  ).bind(FORM).first<{ total: number }>();
  expect(submitted?.total).toBe(5);
});
