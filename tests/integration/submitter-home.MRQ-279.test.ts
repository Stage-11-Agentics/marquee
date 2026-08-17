import { beforeEach, expect, test } from "vitest";

import { app, type Env } from "../../src/index";
import { applyMigrations, env } from "./apply-migrations";

/**
 * CONTRACT · MRQ-279 — the submitter's own home.
 *
 * One page listing every proposal a person has sent **this** conference, with
 * each one's status, reached without a password. Three things here are easy to
 * regress into their comfortable opposites, and each has a test that fails
 * loudly:
 *
 *   - the door answering differently for an address that has proposals and one
 *     that does not, which turns it into a way to find out who submitted;
 *   - the door writing something — a session, a person, a row — before the
 *     mailed link is opened, which is what makes typing a stranger's address
 *     harmless;
 *   - the list blending two conferences, which the org/event split exists to
 *     prevent: the person is org-scoped, the participation is not.
 */

const NOW = Date.UTC(2026, 7, 17, 15, 0, 0);
const ORG_ID = "org_mrq279";
const EVENT_A = "evt_mrq279_a";
const EVENT_B = "evt_mrq279_b";
const SLUG_A = "atlas-conf-2026";
const SLUG_B = "borealis-conf-2026";
const SUBMITTER = "nadia@example.com";
const STRANGER = "nobody-here@example.com";

const SHELL = `<!doctype html><html><head><title>Marquee</title></head><body><div id="app"></div></body></html>`;
const assets = { fetch: async () => new Response(SHELL, { headers: { "content-type": "text/html" } }) } as unknown as Fetcher;

function runtimeEnv(): Env {
  return { ...env, ASSETS: assets } as unknown as Env;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return app.request(path, init, runtimeEnv());
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function askForLink(email: string, event?: string): Promise<Response> {
  return request("/api/v1/public/proposals/link", json({ email, ...(event ? { event } : {}) }));
}

/** The link never leaves the mail, so a test reads it exactly as a person reads their inbox. */
async function linkFromMail(toEmail: string): Promise<string | null> {
  const mail = await env.DB
    .prepare("SELECT text FROM outbox WHERE template_key = 'magic_link_login' AND to_email = ? ORDER BY created_at DESC, id DESC LIMIT 1")
    .bind(toEmail)
    .first<{ text: string }>();
  return /https?:\/\/\S+/.exec(mail?.text ?? "")?.[0] ?? null;
}

async function loginMailCount(): Promise<number> {
  const row = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM outbox WHERE template_key = 'magic_link_login'")
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

function conference(id: string, slug: string, name: string) {
  return env.DB
    .prepare(`INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, accent, status, demo_mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', 1, ?, ?)`)
    .bind(id, ORG_ID, name, slug, "A program", "2026-10-13", "2026-10-15", "America/New_York", "A venue", "#0b6a72", NOW, NOW);
}

function proposal(id: string, eventId: string, title: string, reference: string, status: string) {
  return env.DB
    .prepare(`INSERT INTO submissions (id, event_id, kind, title, abstract, status, origin, submitter_person_id, reference_code, search_blob, submitted_at, created_at, updated_at)
      VALUES (?, ?, 'abstract', ?, ?, ?, 'public', 'person-nadia', ?, ?, ?, ?, ?)`)
    .bind(id, eventId, title, `An abstract for ${title}.`, status, reference, title.toLowerCase(), NOW, NOW, NOW);
}

function submitterOn(id: string, submissionId: string) {
  return env.DB
    .prepare("INSERT INTO participations (id, submission_id, person_id, role, position, confirmation_status, created_at, updated_at) VALUES (?, ?, 'person-nadia', 'submitter', 0, 'pending', ?, ?)")
    .bind(id, submissionId, NOW, NOW);
}

beforeEach(async () => {
  await applyMigrations();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(ORG_ID, "Two Conferences", "two-conferences", NOW, NOW),
    conference(EVENT_A, SLUG_A, "Atlas Conference 2026"),
    conference(EVENT_B, SLUG_B, "Borealis Conference 2026"),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, title, company, bio, social_links, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, NULL, '[]', 0, ?, ?)")
      .bind("person-nadia", ORG_ID, SUBMITTER, "Nadia Okonkwo", NOW, NOW),
    // Two proposals at Atlas, one at Borealis. One person, three participations,
    // two conferences — the shape the org/event split exists for.
    proposal("sub-a1", EVENT_A, "Taming 40-Minute CI", "SUB-1", "submitted"),
    proposal("sub-a2", EVENT_A, "Your AI Pair Programmer Needs a Budget", "SUB-2", "submitted"),
    proposal("sub-b1", EVENT_B, "A Proposal For The Other Conference", "SUB-9", "submitted"),
    submitterOn("par-a1", "sub-a1"),
    submitterOn("par-a2", "sub-a2"),
    submitterOn("par-b1", "sub-b1"),
  ]);
});

test("AC-412 · the door answers a submitter and a stranger with the same sentence, and mails only the submitter", async () => {
  const known = await askForLink(SUBMITTER, SLUG_A);
  const unknown = await askForLink(STRANGER, SLUG_A);

  expect(known.status).toBe(200);
  expect(unknown.status).toBe(200);
  // Byte-identical, not merely both-200: a difference in wording is the oracle.
  expect(await known.clone().text()).toBe(await unknown.clone().text());

  expect(await linkFromMail(SUBMITTER)).toMatch(/\/api\/v1\/auth\/exchange\?token=/);
  expect(await linkFromMail(STRANGER)).toBeNull();
});

test("AC-413 · asking for a link writes nothing — no session, no person, no participation", async () => {
  const before = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n FROM people"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM participations"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM auth_sessions"),
  ]);

  const response = await askForLink(STRANGER, SLUG_A);
  // The one thing that must never come back from this route.
  expect(response.headers.get("set-cookie")).toBeNull();

  const after = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n FROM people"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM participations"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM auth_sessions"),
  ]);
  expect(after.map((result) => (result.results as { n: number }[])[0]!.n))
    .toEqual(before.map((result) => (result.results as { n: number }[])[0]!.n));
});

test("AC-414 · the link is scoped to the conference asked about, never blended across two", async () => {
  const link = await (async () => {
    await askForLink(SUBMITTER, SLUG_A);
    return linkFromMail(SUBMITTER);
  })();
  expect(link).toBeTruthy();

  const exchange = await request(new URL(link!).pathname + new URL(link!).search, { redirect: "manual" });
  expect(exchange.status).toBe(302);
  // The conference travels in the redirect rather than being left to a later
  // fallback ordering, which is what stops a two-conference submitter landing
  // on the wrong list.
  expect(exchange.headers.get("location")).toBe(`/portal?eventId=${EVENT_A}`);

  const cookie = exchange.headers.get("set-cookie")?.split(";")[0] ?? "";
  const portal = await request(`/api/v1/me/portal?eventId=${EVENT_A}`, { headers: { cookie } });
  expect(portal.status).toBe(200);
  const snapshot = await portal.json<{ seat: string; submissions: Array<{ reference_code: string | null }> }>();
  expect(snapshot.seat).toBe("submitter");
  expect(snapshot.submissions.map((row) => row.reference_code).sort()).toEqual(["SUB-1", "SUB-2"]);
});

test("AC-415 · every proposal carries its reference code and the decision that stands", async () => {
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO submission_decisions (id, event_id, submission_id, decision, resulting_status, feedback_md, decided_by_person_id, decided_at, created_at, updated_at)
      VALUES (?, ?, ?, 'maybe', 'waitlisted', ?, 'person-nadia', ?, ?, ?)`)
      .bind("dec-first", EVENT_A, "sub-a1", "Held for a later round.", NOW - 1000, NOW, NOW),
    // A record can be decided, reversed and decided again; the page owes the
    // submitter the one that stands, not the first one written.
    env.DB.prepare(`INSERT INTO submission_decisions (id, event_id, submission_id, decision, resulting_status, feedback_md, decided_by_person_id, decided_at, created_at, updated_at)
      VALUES (?, ?, ?, 'approve', 'accepted', ?, 'person-nadia', ?, ?, ?)`)
      .bind("dec-second", EVENT_A, "sub-a1", "The committee wants this on the Infra track.", NOW, NOW, NOW),
    env.DB.prepare("UPDATE submissions SET status = 'accepted', decided_at = ? WHERE id = 'sub-a1'").bind(NOW),
  ]);

  await askForLink(SUBMITTER, SLUG_A);
  const link = await linkFromMail(SUBMITTER);
  const exchange = await request(new URL(link!).pathname + new URL(link!).search, { redirect: "manual" });
  const cookie = exchange.headers.get("set-cookie")?.split(";")[0] ?? "";
  const portal = await request(`/api/v1/me/portal?eventId=${EVENT_A}`, { headers: { cookie } });
  const snapshot = await portal.json<{
    submissions: Array<{
      reference_code: string | null;
      status: string;
      decision: { status: string; decided_at: number; feedback_md: string | null } | null;
    }>;
  }>();

  const decided = snapshot.submissions.find((row) => row.reference_code === "SUB-1");
  expect(decided?.status).toBe("accepted");
  expect(decided?.decision?.status).toBe("accepted");
  expect(decided?.decision?.feedback_md).toBe("The committee wants this on the Infra track.");

  const undecided = snapshot.submissions.find((row) => row.reference_code === "SUB-2");
  expect(undecided?.decision).toBeNull();
});

test("AC-416 · a named conference is resolved whatever its status, so an open call before launch still has a door", async () => {
  await env.DB.prepare("UPDATE events SET status = 'draft' WHERE id = ?").bind(EVENT_A).run();
  await askForLink(SUBMITTER, SLUG_A);
  expect(await linkFromMail(SUBMITTER)).toMatch(/\/api\/v1\/auth\/exchange\?token=/);
});

test("AC-417 · one address cannot be used as a mail cannon", async () => {
  const before = await loginMailCount();
  for (let attempt = 0; attempt < 9; attempt += 1) await askForLink(SUBMITTER, SLUG_A);
  const sent = (await loginMailCount()) - before;
  expect(sent).toBeGreaterThan(0);
  expect(sent).toBeLessThanOrEqual(6);
});

test("AC-418 · the page opens with no session and never names an address", async () => {
  const page = await request("/my-proposals");
  expect(page.status).toBe(200);
  const html = await page.text();
  expect(html).toContain("Every proposal you have sent");
  expect(html).toContain("Atlas Conference 2026");
  expect(html).not.toContain(SUBMITTER);
  // A door must never be cached: the next reader is a different person.
  expect(page.headers.get("cache-control")).toBe("no-store");
});
