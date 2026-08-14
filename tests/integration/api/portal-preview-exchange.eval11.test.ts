import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { createSession, resolveSession } from "../../../src/lib/auth/auth-sessions";
import { applyMigrations, env } from "../apply-migrations";

/**
 * sbek round 11, SPK-07, second layer: the tab opens and the action still does
 * not complete.
 *
 * "Open portal as this speaker →" mints an ordinary person-bound magic link and
 * navigates the organizer's browser to `/api/v1/auth/exchange`. That navigation
 * is same-origin, so it carries the organizer's own `mq_session` — and the
 * exchange refuses any live link presented by a browser that is already signed
 * in as somebody else, redirecting to `/signin?reason=already_signed_in`.
 *
 * That refusal is correct and stays: it is what stops a stray link silently
 * swapping who you are signed in as. What it lacked was a way to say "an
 * authenticated organizer is deliberately opening this speaker's portal", which
 * is a different act from a link arriving out of nowhere.
 *
 * The eleven-step walkthrough is the product's spine and must complete with
 * zero dead ends. A dead end that now opens a tab before dead-ending is not a
 * fixed dead end.
 */

const ORIGIN = "https://marquee.stage11.dev";
const ORG_ID = "org_spk07_preview";
const EVENT_ID = "evt_spk07_preview";
const OTHER_EVENT_ID = "evt_spk07_other";
const OWNER_ID = "person_spk07_owner";
const SPEAKER_ID = "person_spk07_speaker";
const OTHER_SPEAKER_ID = "person_spk07_other_speaker";
const BYSTANDER_ID = "person_spk07_bystander";

let ownerCookie = "";
let ownerSessionId = "";
let bystanderCookie = "";

async function seedFixture(): Promise<void> {
  await applyMigrations();
  const now = Date.parse("2026-08-14T12:00:00.000Z");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(ORG_ID, "SPK-07 Preview", "spk07-preview", now, now),
    env.DB.prepare("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, ?, ?, '2026-10-01', '2026-10-03', 'UTC', 'live', 1, ?, ?), (?, ?, ?, ?, '2026-11-01', '2026-11-03', 'UTC', 'live', 1, ?, ?)").bind(EVENT_ID, ORG_ID, "Preview Conference", "spk07-preview", now, now, OTHER_EVENT_ID, ORG_ID, "Other Conference", "spk07-other", now, now),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, social_links, created_at, updated_at) VALUES (?, ?, ?, ?, '[]', ?, ?), (?, ?, ?, ?, '[]', ?, ?), (?, ?, ?, ?, '[]', ?, ?), (?, ?, ?, ?, '[]', ?, ?)").bind(
      OWNER_ID, ORG_ID, "owner@spk07.test", "Program owner", now, now,
      SPEAKER_ID, ORG_ID, "speaker@spk07.test", "Priya Raman", now, now,
      OTHER_SPEAKER_ID, ORG_ID, "other@spk07.test", "Other Event Speaker", now, now,
      BYSTANDER_ID, ORG_ID, "bystander@spk07.test", "Bystander Speaker", now, now,
    ),
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'program_lead', ?, ?), (?, ?, ?, ?, 'speaker', ?, ?), (?, ?, ?, ?, 'speaker', ?, ?), (?, ?, ?, ?, 'speaker', ?, ?)").bind(
      "mem_spk07_owner", ORG_ID, EVENT_ID, OWNER_ID, now, now,
      "mem_spk07_speaker", ORG_ID, EVENT_ID, SPEAKER_ID, now, now,
      "mem_spk07_bystander", ORG_ID, EVENT_ID, BYSTANDER_ID, now, now,
      "mem_spk07_other", ORG_ID, OTHER_EVENT_ID, OTHER_SPEAKER_ID, now, now,
    ),
  ]);
  const owner = await createSession(env.DB, { personId: OWNER_ID, roleHint: "program_lead", userAgent: "spk07-test", now });
  ownerSessionId = owner.id;
  ownerCookie = `mq_session=${owner.id}`;
  const bystander = await createSession(env.DB, { personId: BYSTANDER_ID, roleHint: "login", userAgent: "spk07-test", now });
  bystanderCookie = `mq_session=${bystander.id}`;
}

async function request(path: string, init: RequestInit = {}, cookie = ownerCookie): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers, redirect: "manual" });
}

/**
 * A browser following the link, rather than a script calling the API. The
 * distinction is load-bearing: the exchange answers a navigation with a 302 to
 * a page and an API call with a JSON error, so a test that omits the Accept
 * header is testing the wrong half of the route.
 */
async function navigate(url: string, cookie = ownerCookie): Promise<Response> {
  const parsed = new URL(url, ORIGIN);
  return request(parsed.pathname + parsed.search, { headers: { accept: "text/html,application/xhtml+xml" } }, cookie);
}

/** The URL the speaker record's button actually navigates to. */
async function previewUrl(personId = SPEAKER_ID, cookie = ownerCookie): Promise<string> {
  const response = await request(`/api/v1/events/${EVENT_ID}/speakers/${personId}/portal-preview`, { method: "POST", body: "{}" }, cookie);
  const payload = await response.text();
  expect(response.status, payload).toBe(200);
  return (JSON.parse(payload) as { url: string }).url;
}

function sessionCookieFrom(response: Response): string | null {
  const header = response.headers.get("set-cookie");
  const match = header?.match(/mq_session=([^;]+)/);
  return match?.[1] ?? null;
}

describe.sequential("SPK-07 portal preview exchange", () => {
  beforeAll(seedFixture, 20_000);

  test("AC-284 · a signed-in organizer opening a speaker's portal lands in the portal, not on /signin", async () => {
    const url = await previewUrl();
    const landed = await navigate(url);

    expect(landed.status).toBe(302);
    const location = landed.headers.get("location") ?? "";
    // The whole finding, in one assertion.
    expect(location, "the organizer must reach the portal").not.toContain("/signin");
    expect(location).not.toContain("already_signed_in");
    expect(location).toContain("/portal");
    expect(location).toContain("viewing_as=speaker");

    // And they arrive as the speaker, which is what makes the portal show that
    // speaker's tasks — the point of the preview.
    const minted = sessionCookieFrom(landed);
    expect(minted, "the exchange minted a session").not.toBeNull();
    const session = await resolveSession(env.DB, minted!);
    expect(session?.person_id).toBe(SPEAKER_ID);
  });

  test("AC-284 · the preview is one-time, exactly like every other magic link", async () => {
    const url = await previewUrl();
    expect((await navigate(url)).headers.get("location")).toContain("/portal");
    // Spending it twice must not work, or a preview URL in a log is a standing
    // key to that speaker's portal.
    expect((await navigate(url)).headers.get("location") ?? "").not.toContain("/portal");
  });

  test("AC-284 · the organizer can get back to their own seat", async () => {
    const url = await previewUrl();
    const landed = await navigate(url);
    const previewCookie = `mq_session=${sessionCookieFrom(landed)}`;

    const back = await request("/api/v1/auth/exit-preview", { method: "POST", body: "{}" }, previewCookie);
    expect(back.status).toBe(200);
    const restored = sessionCookieFrom(back);
    expect(restored, "the organizer's own session is handed back").toBe(ownerSessionId);
    expect((await resolveSession(env.DB, restored!))?.person_id).toBe(OWNER_ID);
  });

  test("AC-284 · the already-signed-in protection still holds for an ordinary login link", async () => {
    // The guard exists so a stray link cannot silently swap who a browser is
    // signed in as. Only a deliberate organizer preview is exempt, and the
    // exemption travels with the minted link rather than in the caller's URL —
    // so an ordinary link cannot be escalated by editing the address bar.
    const invite = await request(`/api/v1/events/${EVENT_ID}/speakers/invite`, { method: "POST", body: JSON.stringify({ person_ids: [BYSTANDER_ID] }) });
    const invitePayload = await invite.text();
    expect(invite.status, invitePayload).toBe(200);
    const link = (JSON.parse(invitePayload) as { invites: Array<{ magic_link?: string }> }).invites[0]?.magic_link;
    expect(link, "the demo outbox returns the link on screen").toBeTruthy();

    const refused = await navigate(link!);
    expect(refused.headers.get("location") ?? "").toContain("already_signed_in");
    // And it is still refused with the preview marker bolted onto the address.
    expect((await navigate(`${link!}&viewing_as=speaker`)).headers.get("location") ?? "").toContain("already_signed_in");
  });

  test("AC-284 · a preview link is refused for a browser that is not an organizer of that conference", async () => {
    const url = await previewUrl();
    // A speaker who happens to be signed in gets the ordinary refusal: the
    // exemption is for organizers of this conference, not for anyone holding
    // the URL.
    const asSpeaker = await navigate(url, bystanderCookie);
    expect(asSpeaker.headers.get("location") ?? "").toContain("already_signed_in");

    // The link is not spent by the refusal, so the organizer it was minted for
    // can still use it.
    expect((await navigate(url)).headers.get("location") ?? "").toContain("/portal");
  });

  test("AC-284 · a signed-out browser follows a preview link the ordinary way", async () => {
    // Nothing about this change may make an anonymous exchange harder: that is
    // the path every real speaker uses.
    const url = await previewUrl();
    const landed = await navigate(url, "");
    expect(landed.status).toBe(302);
    expect(landed.headers.get("location") ?? "").toContain("/portal");
    expect((await resolveSession(env.DB, sessionCookieFrom(landed)!))?.person_id).toBe(SPEAKER_ID);
  });

  test("AC-284 · exit-preview refuses a session that is not a preview", async () => {
    // Otherwise it is a free session-swap primitive.
    expect((await request("/api/v1/auth/exit-preview", { method: "POST", body: "{}" }, ownerCookie)).status).toBe(403);
    expect((await request("/api/v1/auth/exit-preview", { method: "POST", body: "{}" }, "")).status).toBe(401);
  });
});
