import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

import { createSession, resolveSession } from "../../../src/lib/auth/auth-sessions";
import { applyMigrations, env } from "../apply-migrations";

/**
 * SPK-07 follow-up: the preview marker was forgeable by anyone with an address.
 *
 * The exchange lets a signed-in organizer past the already-signed-in guard when
 * the link's STORED `redirect_to` carries a preview marker and the organizer
 * really does hold `ops` over the conference it names. The reasoning for that
 * was that the marker is server-minted "by a route that already checked the
 * caller is an organizer of that conference".
 *
 * That is true of the preview route and false of `POST /api/v1/auth/magic-link`,
 * which is public and writes a CALLER-SUPPLIED `redirect_to` verbatim onto the
 * link row. `safeNext` proves the value is a same-origin relative path; it
 * never looked at the query. So the marker could be written by the attacker
 * rather than the server, and the read path — which was verified, and is
 * correct — was verifying a forged value.
 *
 * The chain: attacker requests their OWN login link with a marked redirect,
 * forwards the mailed link to a signed-in organizer of that conference, and the
 * organizer's click unseats them into the ATTACKER'S session. Precisely the
 * protection the guard exists to give.
 *
 * The lesson underneath, which is why this file exists rather than another
 * assertion in the exchange's own suite: the read path was proven and the WRITE
 * path was assumed. "Who can write this field?" is the other half of "is this
 * field trusted?".
 */

const ORIGIN = "https://marquee.stage11.dev";
const ORG_ID = "org_forge";
const EVENT_ID = "evt_forge";
const OWNER_ID = "person_forge_owner";
const SPEAKER_ID = "person_forge_speaker";
const ATTACKER_ID = "person_forge_attacker";
const ATTACKER_EMAIL = "attacker@forge.test";

let ownerCookie = "";

async function seedFixture(): Promise<void> {
  await applyMigrations();
  const now = Date.parse("2026-08-14T12:00:00.000Z");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(ORG_ID, "Forge Org", "forge-org", now, now),
    env.DB.prepare("INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at) VALUES (?, ?, ?, ?, '2026-10-01', '2026-10-03', 'UTC', 'live', 1, ?, ?)").bind(EVENT_ID, ORG_ID, "Forge Conference", "forge", now, now),
    env.DB.prepare("INSERT INTO people (id, org_id, email, name, social_links, created_at, updated_at) VALUES (?, ?, ?, ?, '[]', ?, ?), (?, ?, ?, ?, '[]', ?, ?), (?, ?, ?, ?, '[]', ?, ?)").bind(
      OWNER_ID, ORG_ID, "owner@forge.test", "Program owner", now, now,
      SPEAKER_ID, ORG_ID, "speaker@forge.test", "Priya Raman", now, now,
      ATTACKER_ID, ORG_ID, ATTACKER_EMAIL, "Mallory", now, now,
    ),
    // The attacker is an ordinary speaker on this conference — an address in the
    // system, which is the entire prerequisite for the forgery.
    env.DB.prepare("INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'program_lead', ?, ?), (?, ?, ?, ?, 'speaker', ?, ?), (?, ?, ?, ?, 'speaker', ?, ?)").bind(
      "mem_forge_owner", ORG_ID, EVENT_ID, OWNER_ID, now, now,
      "mem_forge_speaker", ORG_ID, EVENT_ID, SPEAKER_ID, now, now,
      "mem_forge_attacker", ORG_ID, EVENT_ID, ATTACKER_ID, now, now,
    ),
  ]);
  const owner = await createSession(env.DB, { personId: OWNER_ID, roleHint: "program_lead", userAgent: "forge-test", now });
  ownerCookie = `mq_session=${owner.id}`;
}

async function request(path: string, init: RequestInit = {}, cookie = ""): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers, redirect: "manual" });
}

/** A browser following the link, which is how the exchange answers with a 302. */
async function navigate(url: string, cookie: string): Promise<Response> {
  const parsed = new URL(url, ORIGIN);
  return request(parsed.pathname + parsed.search, { headers: { accept: "text/html,application/xhtml+xml" } }, cookie);
}

function sessionCookieFrom(response: Response): string | null {
  return response.headers.get("set-cookie")?.match(/mq_session=([^;]+)/)?.[1] ?? null;
}

/**
 * What the public door stores for a caller-supplied `redirect_to`.
 *
 * Prior rows are cleared first and exactly one is required afterwards. The
 * route answers 200 with the same non-enumerating message whether or not it
 * minted anything, so reading "the newest row" would quietly return the
 * PREVIOUS call's value and turn a mint that never happened into a passing
 * assertion.
 */
async function mintOwnLink(redirectTo: string): Promise<string> {
  await env.DB.prepare("DELETE FROM magic_links WHERE person_id = ?").bind(ATTACKER_ID).run();
  const response = await request("/api/v1/auth/magic-link", {
    method: "POST",
    body: JSON.stringify({ email: ATTACKER_EMAIL, event_id: EVENT_ID, redirect_to: redirectTo }),
  });
  expect(response.status, await response.text()).toBe(200);
  const rows = await env.DB.prepare("SELECT redirect_to FROM magic_links WHERE person_id = ?").bind(ATTACKER_ID).all<{ redirect_to: string }>();
  expect(rows.results.length, `the public door minted exactly one link for ${redirectTo}`).toBe(1);
  return rows.results[0]!.redirect_to;
}

describe.sequential("SPK-07 preview marker forgery", () => {
  beforeAll(seedFixture, 20_000);

  test("CONTRACT · SPK-07 · a caller-supplied redirect cannot carry a preview marker", async () => {
    const stored = await mintOwnLink(`/portal?viewing_as=speaker&eventId=${EVENT_ID}`);

    // The stored value is what the exchange reads, so this is the assertion
    // that matters: the marker must not survive to the row.
    expect(stored, "the stored redirect must not carry a preview marker").not.toContain("viewing_as");
    // Stripping is lossless for a legitimate caller: the path they asked for
    // still stands, and `eventId` survives because the portal genuinely scopes
    // itself with it and the product's own server-minted links carry it. Only
    // the PAIR is the marker, and removing either half unmakes it.
    expect(stored).toBe(`/portal?eventId=${EVENT_ID}`);
  });

  test("CONTRACT · SPK-07 · a forged link cannot unseat a signed-in organizer", async () => {
    // The whole chain, end to end, as an attacker would run it.
    await env.DB.prepare("DELETE FROM outbox WHERE person_id = ?").bind(ATTACKER_ID).run();
    const stored = await mintOwnLink(`/portal?viewing_as=speaker&eventId=${EVENT_ID}`);

    // The organizer clicks the forwarded link while signed in.
    const landed = await navigate(`/api/v1/auth/exchange?token=${await forwardedToken()}`, ownerCookie);

    // The ordinary refusal, not a preview.
    expect(landed.headers.get("location") ?? "", "the guard must hold against a forged marker").toContain("already_signed_in");
    expect(sessionCookieFrom(landed), "no session may be minted").toBeNull();
    expect(stored).not.toContain("viewing_as");
  });

  test("CONTRACT · SPK-07 · a marker on the row still cannot open a non-speaker's portal", async () => {
    // The second layer, tested where the first cannot reach it. The strip stops
    // the marker being WRITTEN through the public door; this proves the exchange
    // would refuse one that arrived by some other path anyway — a future
    // caller-supplied redirect, a migration, a direct write.
    //
    // So the row is forged directly here, which no route allows, precisely
    // because the point is to test the layer that does not depend on the
    // marker's provenance.
    const outsider = "person_forge_outsider";
    const now = Date.parse("2026-08-14T12:00:00.000Z");
    await env.DB.prepare("INSERT OR IGNORE INTO people (id, org_id, email, name, social_links, created_at, updated_at) VALUES (?, ?, ?, ?, '[]', ?, ?)")
      .bind(outsider, ORG_ID, "outsider@forge.test", "Not a speaker here", now, now).run();

    const token = "forge_direct_token_value";
    const tokenHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))]
      .map((byte) => byte.toString(16).padStart(2, "0")).join("");
    await env.DB.prepare(
      `INSERT INTO magic_links (id, token_hash, person_id, purpose, redirect_to, expires_at, used_at, created_at, updated_at)
       VALUES (?, ?, ?, 'login', ?, ?, NULL, ?, ?)`,
    ).bind("ml_forge_direct", tokenHash, outsider, `/portal?viewing_as=speaker&eventId=${EVENT_ID}`, Date.now() + 900_000, now, now).run();

    const landed = await navigate(`/api/v1/auth/exchange?token=${token}`, ownerCookie);
    expect(landed.headers.get("location") ?? "", "a non-speaker is not previewable").toContain("already_signed_in");
    expect(sessionCookieFrom(landed)).toBeNull();
  });

  test("CONTRACT · SPK-07 · an ordinary caller-supplied redirect is untouched", async () => {
    // The strip must cost a legitimate `?next=` nothing beyond the two reserved
    // parameters, or it becomes a bug of its own.
    expect(await mintOwnLink("/portal")).toBe("/portal");
    expect(await mintOwnLink("/submissions?status=accepted&sort=title")).toBe("/submissions?status=accepted&sort=title");
    // `eventId` alone is how the portal scopes itself, and it is written by the
    // product's own server-minted links — only the pair is the marker.
    expect(await mintOwnLink("/reviewer?round=r1")).toBe("/reviewer?round=r1");
  });
});

/**
 * The raw token is returned once at mint and never stored, so a test cannot
 * read it back out of D1. The public door does not hand it over either. The
 * attacker in the real chain has it because it was mailed to them; here it is
 * recovered from the outbox the demo instance writes.
 */
async function forwardedToken(): Promise<string> {
  const row = await env.DB.prepare("SELECT text FROM outbox WHERE person_id = ? ORDER BY created_at DESC LIMIT 1").bind(ATTACKER_ID).first<{ text: string }>();
  const token = row?.text.match(/exchange\?token=([A-Za-z0-9_-]+)/)?.[1];
  expect(token, "the mailed link carries the token the attacker forwards").toBeTruthy();
  return token!;
}
