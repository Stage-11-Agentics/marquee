import { beforeEach, expect, test } from "vitest";

import { app } from "../../src/index";
import { mintToken, sha256Hex } from "../../src/lib/auth/random-token";
import { roleForEvent } from "../../src/lib/auth/scope-resolution";
import { applyMigrations, env } from "./apply-migrations";

beforeEach(async () => {
  await applyMigrations();
});

async function seedOrgAndPeople() {
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind("org_1", "Org One", "org-one", now, now)
    .run();
  await env.DB.prepare(
    `INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?)`,
  )
    .bind("evt_a", "org_1", "Event A", "event-a", "", "2026-10-01", "2026-10-02", "UTC", "", now, now)
    .run();
  await env.DB.prepare(
    `INSERT INTO events (id, org_id, name, slug, tagline, starts_on, ends_on, timezone, venue, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?)`,
  )
    .bind("evt_b", "org_1", "Event B", "event-b", "", "2026-11-01", "2026-11-02", "UTC", "", now, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO people (id, org_id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind("per_1", "org_1", "creator@org-one.example", "Creator", now, now)
    .run();
  return { now };
}

test("AC-107 · bearer token authenticates with no cookie present, and revoking it 401s the next call", async () => {
  const { now } = await seedOrgAndPeople();
  const rawToken = `mq_${mintToken()}`;
  const tokenHash = await sha256Hex(rawToken);
  await env.DB.prepare(
    `INSERT INTO api_tokens (id, org_id, event_id, name, token_hash, prefix, scopes, created_by, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      "tok_1",
      "org_1",
      "Test token",
      tokenHash,
      rawToken.slice(0, 7),
      JSON.stringify({ permissions: ["owner"], event_ids: [] }),
      "per_1",
      now,
      now,
    )
    .run();

  const authed = await app.request(
    "/api/v1/auth/me",
    { headers: { authorization: `Bearer ${rawToken}` } },
    env,
  );
  expect(authed.status).toBe(200);
  const body = await authed.json<{ kind: string }>();
  expect(body.kind).toBe("api_token");

  await env.DB.prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = ?").bind(Date.now(), "tok_1").run();

  const revoked = await app.request(
    "/api/v1/auth/me",
    { headers: { authorization: `Bearer ${rawToken}` } },
    env,
  );
  expect(revoked.status).toBe(401);
});

test("CONTRACT · reviewer scope does not cross events", async () => {
  const now = Date.now();
  const memberships = [
    {
      id: "mem_1",
      org_id: "org_1",
      event_id: "evt_a",
      person_id: "per_1",
      role: "reviewer" as const,
      created_at: now,
      updated_at: now,
    },
  ];
  expect(roleForEvent(memberships, "evt_a")).toBe("reviewer");
  expect(roleForEvent(memberships, "evt_b")).toBeNull();
});

test("CONTRACT · org-wide roles apply to every event in the org except reviewer", async () => {
  const now = Date.now();
  const memberships = [
    {
      id: "mem_2",
      org_id: "org_1",
      event_id: null,
      person_id: "per_1",
      role: "owner" as const,
      created_at: now,
      updated_at: now,
    },
  ];
  expect(roleForEvent(memberships, "evt_a")).toBe("owner");
  expect(roleForEvent(memberships, "evt_b")).toBe("owner");
});

test("CONTRACT · an org-wide reviewer membership is rejected by the schema CHECK", async () => {
  const { now } = await seedOrgAndPeople();
  await expect(
    env.DB.prepare(
      `INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'reviewer', ?, ?)`,
    )
      .bind("mem_bad", "org_1", "per_1", now, now)
      .run(),
  ).rejects.toThrow();
});
