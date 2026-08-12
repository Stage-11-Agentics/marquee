/**
 * The typed door into the demo.
 *
 * The three one-click seats have always worked; the form beside them is what a
 * visitor reaches for out of habit, and until now typing anything into it on a
 * demo instance produced an acknowledgement and no seat. `organizer@demo.com`
 * and its two siblings close that gap. Everything here is about the gate around
 * them: on a deployment with no demo they must be exactly as unremarkable as an
 * address nobody registered — no seat, no cookie, no different sentence.
 */
import { beforeEach, expect, test } from "vitest";

import { app } from "../../src/index";
import {
  DEMO_ORGANIZER_PERSON_ID,
  DEMO_SPEAKER_PERSON_ID,
  demoFixtureRows,
} from "../../src/lib/reset-demo/demo-fixture";
import { applyMigrations, env } from "./apply-migrations";

const ACKNOWLEDGEMENT = "If that address is registered, a sign-in link is on its way.";

beforeEach(async () => {
  await applyMigrations();
});

async function seedDemoFixture(): Promise<void> {
  const now = Date.now();
  for (const row of demoFixtureRows(now)) {
    await env.DB.prepare(row.statement).bind(...row.bindings).run();
  }
}

interface MagicLinkBody {
  message: string;
  magic_link?: string;
  demo_seat?: { role: string; redirect_to: string };
}

async function requestLink(body: Record<string, unknown>): Promise<Response> {
  return app.request("/api/v1/auth/magic-link", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }, env);
}

async function sessionCount(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM auth_sessions").first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function signinPage(): Promise<string> {
  const response = await app.request("/signin", {}, env);
  expect(response.status).toBe(200);
  return response.text();
}

test("AC-2 · a demo address typed into the form enters the matching seat, session and all", async () => {
  await seedDemoFixture();
  const before = await sessionCount();

  const organizer = await requestLink({ email: "organizer@demo.com" });
  expect(organizer.status).toBe(200);
  expect(organizer.headers.get("set-cookie")).toMatch(/mq_session=/);
  const organizerBody = await organizer.json<MagicLinkBody>();
  expect(organizerBody.demo_seat).toEqual({ role: "organizer", redirect_to: "/dashboard" });
  expect(organizerBody.magic_link).toBeUndefined();

  const speaker = await requestLink({ email: "speaker@demo.com" });
  const speakerBody = await speaker.json<MagicLinkBody>();
  expect(speakerBody.demo_seat).toEqual({ role: "speaker", redirect_to: "/portal" });

  // Two real sessions, not two acknowledgements — and each on its own persona.
  expect(await sessionCount()).toBe(before + 2);
  const owners = await env.DB
    .prepare("SELECT person_id FROM auth_sessions ORDER BY created_at ASC, id ASC")
    .all<{ person_id: string }>();
  expect(new Set(owners.results.map((row) => row.person_id)))
    .toEqual(new Set([DEMO_ORGANIZER_PERSON_ID, DEMO_SPEAKER_PERSON_ID]));
});

test("AC-2 · the address is matched however it was typed", async () => {
  await seedDemoFixture();
  const response = await requestLink({ email: "  Organizer@Demo.COM " });
  expect((await response.json<MagicLinkBody>()).demo_seat?.role).toBe("organizer");
});

test("AC-2 · with demo_mode=0 a demo address is just an unknown address — no seat, no cookie", async () => {
  const before = await sessionCount();
  for (const email of ["organizer@demo.com", "reviewer@demo.com", "speaker@demo.com"]) {
    const response = await requestLink({ email });
    expect(response.status).toBe(200);
    // Byte-for-byte the answer an unregistered address gets. A demo address must
    // not be the one input that tells a stranger what kind of deployment this is.
    expect(await response.json()).toEqual({ ok: true, message: ACKNOWLEDGEMENT });
    expect(response.headers.get("set-cookie")).toBeNull();
  }
  expect(await sessionCount()).toBe(before);
});

test("AC-2 · a role the demo has no persona for falls through rather than inventing a seat", async () => {
  // The small auth fixture seeds an organizer and a speaker and no reviewer.
  await seedDemoFixture();
  const before = await sessionCount();
  const response = await requestLink({ email: "reviewer@demo.com" });
  expect(await response.json()).toEqual({ ok: true, message: ACKNOWLEDGEMENT });
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(await sessionCount()).toBe(before);
});

test("AC-2 · a hostile redirect_to never becomes the demo seat's destination", async () => {
  await seedDemoFixture();
  const response = await requestLink({ email: "organizer@demo.com", redirect_to: "//evil.example/steal" });
  expect((await response.json<MagicLinkBody>()).demo_seat?.redirect_to).toBe("/dashboard");
});

test("AC-2 · a demo instance leads with the seats and prints the addresses that open them", async () => {
  await seedDemoFixture();
  const page = await signinPage();
  const doors = page.indexOf('data-signin-demo="organizer"');
  const form = page.indexOf('id="signin-form"');
  expect(doors).toBeGreaterThan(-1);
  expect(form).toBeGreaterThan(-1);
  // What a judge came for is above the form, not below it.
  expect(doors).toBeLessThan(form);
  for (const address of ["organizer@demo.com", "reviewer@demo.com", "speaker@demo.com"]) {
    expect(page).toContain(address);
  }
});

test("AC-2 · a deployment with no demo shows the form alone, unchanged", async () => {
  const page = await signinPage();
  expect(page).toContain('id="signin-form"');
  expect(page).toContain("Sign in to Marquee");
  expect(page).not.toContain("data-signin-demo=");
  expect(page).not.toContain("organizer@demo.com");
});
