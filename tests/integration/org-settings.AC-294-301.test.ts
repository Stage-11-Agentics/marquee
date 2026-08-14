/**
 * The organization as a record, and the two ways a relationship with it ends.
 *
 * One file on purpose — every Worker-backed file costs a Miniflare isolate and
 * the suite budget is 45 s. The pure-logic halves (the short-code alphabet, the
 * three-layer theme resolution, the surface's route table) live in
 * `tests/unit/`, which pays for neither.
 *
 * The revocation tests are written per-arm rather than as one "access ended"
 * assertion, and that shape is deliberate. Revoking the session and leaving an
 * unexpired sign-in link alive is not a partial fix, it is no fix — and a test
 * that only asserted "their next request 401s" would pass against exactly that
 * bug, because the link has not been presented yet.
 */
import { beforeEach, expect, test } from "vitest";
import { SELF } from "cloudflare:test";

import { createSession } from "../../src/lib/auth/auth-sessions";
import { mintMagicLink } from "../../src/lib/auth/magic-links";
import { sha256Hex } from "../../src/lib/auth/random-token";
import { normalizeShortCode } from "../../src/lib/auth/short-code";
import { applyMigrations, env } from "./apply-migrations";

const ORIGIN = "https://marquee.stage11.dev";
const NOW = Date.UTC(2026, 7, 14, 12, 0, 0);
/**
 * Task deadlines are compared against the real clock by the server, so this one
 * column is derived from it rather than from the pinned fixture anchor — a
 * calendar-pinned `due_at` silently becomes an overdue task once that date
 * passes, and the test starts asserting something different from what it says.
 */
const DUE_AT = Date.now() + 86_400_000;

async function request(path: string, init?: RequestInit): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, init);
}

function credentialFromUrl(url: string): string {
  return new URL(url).pathname.split("/").at(-1) ?? "";
}

interface Instance {
  cookie: string;
  orgId: string;
  ownerId: string;
  eventId: string;
}

/** An owned instance with one conference — the steady state every route here assumes. */
async function seedInstance(suffix = "org207"): Promise<Instance> {
  const orgId = `org_${suffix}`;
  const ownerId = `per_${suffix}_owner`;
  const eventId = `evt_${suffix}`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(orgId, "Great Lakes Infra", `great-lakes-${suffix}`, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, social_links, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'marquee', '{}', ?, ?)",
    ).bind(ownerId, orgId, `sam+${suffix}@gl-infra.dev`, "Sam Okonkwo-Barnes", NOW, NOW),
    env.DB.prepare(
      "INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, NULL, ?, 'owner', ?, ?)",
    ).bind(`mem_${suffix}_owner`, orgId, ownerId, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO events (id, org_id, name, slug, starts_on, ends_on, timezone, status, demo_mode, created_at, updated_at)
       VALUES (?, ?, 'Infra Days', ?, '2027-04-14', '2027-04-15', 'America/New_York', 'draft', 0, ?, ?)`,
    ).bind(eventId, orgId, `infra-days-${suffix}`, NOW, NOW),
  ]);
  const session = await createSession(env.DB, { personId: ownerId, userAgent: "mrq-207" });
  return { cookie: `mq_session=${session.id}`, orgId, ownerId, eventId };
}

async function addPerson(orgId: string, id: string, email: string, name: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO people (id, org_id, email, name, is_demo, last_write_source, social_links, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 'marquee', '{}', ?, ?)",
  )
    .bind(id, orgId, email, name, NOW, NOW)
    .run();
}

async function countOf(sql: string, ...bindings: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql).bind(...bindings).first<{ total: number }>();
  return Number(row?.total ?? 0);
}

beforeEach(async () => {
  await applyMigrations();
});

test("AC-294 · organization defaults round-trip, and unset stays distinguishable from chosen", async () => {
  const { cookie, orgId } = await seedInstance();

  const initial = await request("/api/v1/org/settings", { headers: { cookie } });
  expect(initial.status).toBe(200);
  const before = (await initial.json()) as { data: Record<string, unknown> };
  // A brand-new organization has expressed no preference. Every default is
  // null, not the product's own default wearing a value — that difference is
  // what lets the product change its mind later without silently pinning
  // everyone who never chose.
  expect(before.data.default_timezone).toBeNull();
  expect(before.data.default_theme).toBeNull();
  expect(before.data.comms_from_name).toBeNull();
  expect(before.data.accent).toBeNull();

  const patched = await request("/api/v1/org/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      name: "Great Lakes Infrastructure",
      default_timezone: "America/Chicago",
      default_theme: "night",
      comms_from_name: "Infra Days Programme",
      comms_reply_to: "programme@gl-infra.dev",
      accent: "#3355ff",
    }),
  });
  expect(patched.status).toBe(200);

  const reread = (await (await request("/api/v1/org/settings", { headers: { cookie } })).json()) as {
    data: Record<string, unknown>;
  };
  expect(reread.data).toMatchObject({
    name: "Great Lakes Infrastructure",
    default_timezone: "America/Chicago",
    default_theme: "night",
    comms_from_name: "Infra Days Programme",
    comms_reply_to: "programme@gl-infra.dev",
    accent: "#3355ff",
  });

  // A partial patch moves only what it names. The bug this catches is the
  // UPDATE that writes every column from a partial body and blanks the rest.
  await request("/api/v1/org/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ default_theme: "latent-space" }),
  });
  const afterPartial = (await (await request("/api/v1/org/settings", { headers: { cookie } })).json()) as {
    data: Record<string, unknown>;
  };
  expect(afterPartial.data.default_theme).toBe("latent-space");
  expect(afterPartial.data.default_timezone).toBe("America/Chicago");
  expect(afterPartial.data.comms_from_name).toBe("Infra Days Programme");

  // Null clears back to unset — a distinct act from never having chosen, and
  // one an organizer must be able to perform.
  await request("/api/v1/org/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ default_theme: null }),
  });
  expect(
    ((await (await request("/api/v1/org/settings", { headers: { cookie } })).json()) as { data: Record<string, unknown> })
      .data.default_theme,
  ).toBeNull();

  // Refusals: a theme that is not a theme, a timezone the runtime does not know,
  // and an accent that is not a colour.
  for (const [body, status] of [
    [{ default_theme: "midnight-pro" }, 400],
    [{ default_timezone: "Mars/Olympus" }, 422],
    [{ accent: "cornflower" }, 400],
  ] as const) {
    const refused = await request("/api/v1/org/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    });
    expect(refused.status).toBe(status);
  }

  // Nothing leaked sideways: the settings still belong to one organization.
  expect(await countOf("SELECT COUNT(*) AS total FROM organizations WHERE id = ?", orgId)).toBe(1);
});

test("AC-294 · organization settings are refused to anyone without an organization-wide organizer seat", async () => {
  const { orgId, eventId } = await seedInstance("perm207");
  await addPerson(orgId, "per_perm_ops", "ops@gl-infra.dev", "Devon Ellis");
  // A conference-scoped seat is real authority — over that conference. It is
  // not authority over the organization that owns it.
  await env.DB.prepare(
    "INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'ops', ?, ?)",
  )
    .bind("mem_perm_scoped", orgId, eventId, "per_perm_ops", NOW, NOW)
    .run();
  const scoped = await createSession(env.DB, { personId: "per_perm_ops", userAgent: "mrq-207" });

  const read = await request("/api/v1/org/settings", { headers: { cookie: `mq_session=${scoped.id}` } });
  expect(read.status).toBe(403);
  const write = await request("/api/v1/org/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: `mq_session=${scoped.id}` },
    body: JSON.stringify({ default_theme: "night" }),
  });
  expect(write.status).toBe(403);
  expect(await countOf("SELECT COUNT(*) AS total FROM organizations WHERE default_theme IS NOT NULL")).toBe(0);
});

test("AC-296 · an invite carries its role and scope, and the exchange mints exactly that seat", async () => {
  const { cookie, orgId, eventId } = await seedInstance("invite207");

  const minted = await request("/api/v1/org/invites", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ role: "ops", event_id: eventId }),
  });
  expect(minted.status).toBe(201);
  const body = (await minted.json()) as {
    invite_url: string;
    short_code: string;
    data: { role: string; event_id: string | null; event_name: string | null };
  };
  // The pending row says what it will mint, so an organizer reading the list
  // never has to guess which of three live invites is the day-of volunteer's.
  expect(body.data).toMatchObject({ role: "ops", event_id: eventId, event_name: "Infra Days" });

  const exchanged = await request("/api/v1/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: credentialFromUrl(body.invite_url),
      purpose: "org_invite",
      name: "Rae Ibarra",
      email: "rae@gl-infra.dev",
    }),
  });
  expect(exchanged.status).toBe(200);
  expect((await exchanged.json()) as { role: string; event_id: string | null }).toMatchObject({
    role: "ops",
    event_id: eventId,
  });

  const membership = await env.DB.prepare(
    "SELECT role, event_id FROM memberships WHERE org_id = ? AND person_id = (SELECT id FROM people WHERE email = 'rae@gl-infra.dev')",
  )
    .bind(orgId)
    .all<{ role: string; event_id: string | null }>();
  expect(membership.results).toEqual([{ role: "ops", event_id: eventId }]);
  // The failure this exists to catch: a scoped invite that quietly lands an
  // organization-wide seat, which is a silent privilege escalation nobody sees
  // until the volunteer opens a conference they were never given.
  expect(
    await countOf(
      "SELECT COUNT(*) AS total FROM memberships WHERE org_id = ? AND event_id IS NULL AND person_id != ?",
      orgId,
      `per_invite207_owner`,
    ),
  ).toBe(0);
});

test("AC-296 · the recipient cannot choose their own seat, and a scope must belong to this organization", async () => {
  const { cookie, orgId, eventId } = await seedInstance("seat207");
  const other = await seedInstance("other207");

  // A conference on someone else's organization is not a scope this instance's
  // owner may hand out — and the refusal must not confirm that it exists.
  const foreign = await request("/api/v1/org/invites", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ role: "ops", event_id: other.eventId }),
  });
  expect(foreign.status).toBe(422);

  // `owner` is not an invitable role: ownership moves by transfer, never by a
  // link somebody could forward.
  const escalated = await request("/api/v1/org/invites", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ role: "owner" }),
  });
  expect(escalated.status).toBe(400);

  // A reviewer seat is per conference by construction (AC-214); the schema
  // refuses an org-wide one, so the mint must refuse it first rather than
  // handing out a link that explodes at the door.
  const unscopedReviewer = await request("/api/v1/org/invites", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ role: "reviewer" }),
  });
  expect(unscopedReviewer.status).toBe(422);

  const minted = await request("/api/v1/org/invites", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ role: "reviewer", event_id: eventId }),
  });
  const mintedBody = (await minted.json()) as { invite_url: string };

  // The recipient names themself, and nothing else. A role in the exchange body
  // is ignored, because the seat lives on the consumed row.
  const exchanged = await request("/api/v1/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: credentialFromUrl(mintedBody.invite_url),
      purpose: "org_invite",
      name: "Ambitious Volunteer",
      email: "amb@gl-infra.dev",
      role: "owner",
    }),
  });
  expect(exchanged.status).toBe(200);
  const roles = await env.DB.prepare(
    "SELECT role FROM memberships WHERE org_id = ? AND person_id = (SELECT id FROM people WHERE email = 'amb@gl-infra.dev')",
  )
    .bind(orgId)
    .all<{ role: string }>();
  expect(roles.results.map((row) => row.role)).toEqual(["reviewer"]);
  // And it landed on the organization that minted it, not on whichever
  // organization row happens to sort first.
  const landed = await env.DB.prepare(
    "SELECT org_id, event_id FROM memberships WHERE person_id = (SELECT id FROM people WHERE email = 'amb@gl-infra.dev')",
  ).all<{ org_id: string; event_id: string | null }>();
  expect(landed.results).toEqual([{ org_id: orgId, event_id: eventId }]);
});

test("AC-297 · the short code is the same single-use row, reachable at the same door and hashed at rest", async () => {
  const { cookie } = await seedInstance("code207");
  const minted = await request("/api/v1/org/invites", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ role: "ops" }),
  });
  const body = (await minted.json()) as { invite_url: string; short_code: string; data: { id: string } };

  // Speakable across a desk, and a well-formed code by construction.
  expect(normalizeShortCode(body.short_code)).toBe(body.short_code);

  // Only the hash is stored — of both credentials. The raw code must be no more
  // recoverable from the database than the token is.
  expect(await countOf("SELECT COUNT(*) AS total FROM magic_links WHERE short_code_hash = ?", body.short_code)).toBe(0);
  expect(
    await countOf("SELECT COUNT(*) AS total FROM magic_links WHERE id = ? AND short_code_hash IS NOT NULL", body.data.id),
  ).toBe(1);

  // The same door, lowercased and space-separated the way a human retypes it.
  const spoken = body.short_code.toLowerCase().replaceAll("-", " ");
  const page = await request(`/join/${encodeURIComponent(spoken)}`);
  expect(page.status).toBe(200);
  expect(await page.text()).not.toContain("Invite link · spent");

  const exchanged = await request("/api/v1/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: spoken, purpose: "org_invite", name: "Desk Volunteer", email: "desk@gl-infra.dev" }),
  });
  expect(exchanged.status).toBe(200);

  // One row, one use. Having spent the code, the long token is dead too — the
  // bug this catches is a second credential that is really a second invite.
  const replay = await request("/api/v1/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: credentialFromUrl(body.invite_url),
      purpose: "org_invite",
      name: "Someone Else",
      email: "else@gl-infra.dev",
    }),
  });
  expect(replay.status).toBe(401);
  expect(await countOf("SELECT COUNT(*) AS total FROM people WHERE email = 'else@gl-infra.dev'")).toBe(0);

  // A code that was never minted is the same inert answer as a dead one.
  const nonsense = await request("/api/v1/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "AMBER-FALCON-0000", purpose: "org_invite", name: "X", email: "x@gl-infra.dev" }),
  });
  expect(nonsense.status).toBe(401);
});

test("AC-298 · removing an organizer revokes their session — arm one", async () => {
  const { cookie, orgId } = await seedInstance("arm1");
  await addPerson(orgId, "per_arm1_member", "lee@gl-infra.dev", "Lee Trevino-Adams");
  await env.DB.prepare(
    "INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, NULL, ?, 'program_lead', ?, ?)",
  )
    .bind("mem_arm1", orgId, "per_arm1_member", NOW, NOW)
    .run();
  const theirs = await createSession(env.DB, { personId: "per_arm1_member", userAgent: "mrq-207" });
  expect((await request("/api/v1/org/members", { headers: { cookie: `mq_session=${theirs.id}` } })).status).toBe(200);

  const removed = await request("/api/v1/org/members/per_arm1_member", { method: "DELETE", headers: { cookie } });
  expect(removed.status).toBe(200);
  expect((await removed.json()) as { data: { revoked_sessions: number } }).toMatchObject({
    data: { revoked_sessions: 1 },
  });

  expect((await request("/api/v1/org/members", { headers: { cookie: `mq_session=${theirs.id}` } })).status).toBe(401);
  expect(
    await countOf("SELECT COUNT(*) AS total FROM auth_sessions WHERE person_id = ? AND revoked_at IS NULL", "per_arm1_member"),
  ).toBe(0);
});

test("AC-298 · removing an organizer consumes the unexpired sign-in link already in their inbox — arm two", async () => {
  const { cookie, orgId } = await seedInstance("arm2");
  await addPerson(orgId, "per_arm2_member", "kit@gl-infra.dev", "Kit Nakamura-Boyd");
  await env.DB.prepare(
    "INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, NULL, ?, 'ops', ?, ?)",
  )
    .bind("mem_arm2", orgId, "per_arm2_member", NOW, NOW)
    .run();
  // The link that is the whole point of this arm: already sent, still valid,
  // and a straight path back in the moment the session closes.
  const live = await mintMagicLink(env.DB, { personId: "per_arm2_member", purpose: "login", redirectTo: "/dashboard" });
  // Two links that must NOT move: one already spent, one already expired.
  // Re-dating either would rewrite history to make a revocation look thorough.
  const spent = await mintMagicLink(env.DB, { personId: "per_arm2_member", purpose: "login" });
  await env.DB.prepare("UPDATE magic_links SET used_at = ? WHERE id = ?").bind(NOW, spent.id).run();
  const stale = await mintMagicLink(env.DB, { personId: "per_arm2_member", purpose: "login" });
  await env.DB.prepare("UPDATE magic_links SET expires_at = ? WHERE id = ?").bind(NOW, stale.id).run();

  // Before acting: exactly one live link, and two that are already dead in the
  // two different ways. Without this, a fixture that minted nothing would let
  // every assertion below pass while proving nothing was revoked.
  expect(
    await countOf(
      "SELECT COUNT(*) AS total FROM magic_links WHERE person_id = ? AND used_at IS NULL AND expires_at > ?",
      "per_arm2_member",
      Date.now(),
    ),
  ).toBe(1);
  expect(await countOf("SELECT COUNT(*) AS total FROM magic_links WHERE person_id = ?", "per_arm2_member")).toBe(3);

  const removed = await request("/api/v1/org/members/per_arm2_member", { method: "DELETE", headers: { cookie } });
  expect(removed.status).toBe(200);
  expect((await removed.json()) as { data: { consumed_links: number } }).toMatchObject({ data: { consumed_links: 1 } });

  const after = await env.DB.prepare("SELECT id, used_at FROM magic_links WHERE person_id = ? ORDER BY id")
    .bind("per_arm2_member")
    .all<{ id: string; used_at: number | null }>();
  const byId = new Map(after.results.map((row) => [row.id, row.used_at]));
  expect(byId.get(live.id)).not.toBeNull();
  expect(byId.get(spent.id)).toBe(NOW);
  expect(byId.get(stale.id)).toBeNull();
});

test("AC-298 · removing an organizer revokes the tokens they minted, sparing only what the human kept — arm three", async () => {
  const { cookie, orgId, eventId } = await seedInstance("arm3");
  await addPerson(orgId, "per_arm3_member", "noor@gl-infra.dev", "Noor Haddad-Wells");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, NULL, ?, 'program_lead', ?, ?)",
    ).bind("mem_arm3", orgId, "per_arm3_member", NOW, NOW),
    ...["tok_fired_a", "tok_fired_b"].map((id) =>
      env.DB.prepare(
        `INSERT INTO api_tokens (id, org_id, event_id, name, token_hash, prefix, scopes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'mq_test', '{"permissions":["program:read"],"event_ids":[]}', ?, ?, ?)`,
      ).bind(id, orgId, null, id, `hash_${id}`, "per_arm3_member", NOW, NOW),
    ),
    // Someone else's token, minted by the owner. Nothing about firing this
    // person may touch it.
    env.DB.prepare(
      `INSERT INTO api_tokens (id, org_id, event_id, name, token_hash, prefix, scopes, created_by, created_at, updated_at)
       VALUES ('tok_owner', ?, ?, 'owner token', 'hash_owner', 'mq_test', '{"permissions":["program:read"],"event_ids":[]}', ?, ?, ?)`,
    ).bind(orgId, null, `per_arm3_owner`, NOW, NOW),
  ]);

  // Before acting: three live tokens. A revocation test against a fixture with
  // nothing to revoke passes beautifully and proves nothing.
  expect(await countOf("SELECT COUNT(*) AS total FROM api_tokens WHERE revoked_at IS NULL")).toBe(3);

  // Show-and-choose (ruling O3): the dialog pre-checks revoke, and the human
  // unchecked one because it powers an integration the organization keeps.
  // Keeping is the explicit act; revoking is what happens by default.
  const removed = await request("/api/v1/org/members/per_arm3_member", {
    method: "DELETE",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ keep_token_ids: ["tok_fired_b"] }),
  });
  expect(removed.status).toBe(200);
  expect((await removed.json()) as { data: { revoked_tokens: number } }).toMatchObject({ data: { revoked_tokens: 1 } });

  const tokens = await env.DB.prepare("SELECT id, revoked_at FROM api_tokens ORDER BY id")
    .all<{ id: string; revoked_at: number | null }>();
  const revoked = new Map(tokens.results.map((row) => [row.id, row.revoked_at]));
  expect(revoked.get("tok_fired_a")).not.toBeNull();
  expect(revoked.get("tok_fired_b")).toBeNull();
  // Never theirs to lose: `created_by` is the owner, not the removed member.
  expect(revoked.get("tok_owner")).toBeNull();
});

test("AC-298 · removal reaches only the removed member's own credentials, and every organizer seat ends at once", async () => {
  const { cookie, orgId, eventId } = await seedInstance("arm4");
  await addPerson(orgId, "per_arm4_member", "sol@gl-infra.dev", "Sol Ferreira-Nunes");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, NULL, ?, 'program_lead', ?, ?)",
    ).bind("mem_arm4_org", orgId, "per_arm4_member", NOW, NOW),
    // The day-of volunteer seat from ruling O4. Leaving it behind is exactly the
    // defect the widened delete exists to prevent.
    env.DB.prepare(
      "INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'ops', ?, ?)",
    ).bind("mem_arm4_evt", orgId, eventId, "per_arm4_member", NOW, NOW),
    env.DB.prepare(
      `INSERT INTO api_tokens (id, org_id, event_id, name, token_hash, prefix, scopes, created_by, created_at, updated_at)
       VALUES ('tok_not_theirs', ?, ?, 'someone elses', 'hash_nt', 'mq_test', '{"permissions":["program:read"],"event_ids":[]}', ?, ?, ?)`,
    ).bind(orgId, null, "per_arm4_owner", NOW, NOW),
  ]);

  // A token id is client-supplied, and `keep_token_ids` naming somebody else's
  // must neither revoke it nor shield it: the `created_by` predicate is what
  // decides whose credentials this action can reach, and it is the only thing
  // that decides it.
  const removed = await request("/api/v1/org/members/per_arm4_member", {
    method: "DELETE",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ keep_token_ids: ["tok_not_theirs"] }),
  });
  expect(removed.status).toBe(200);
  expect(
    await countOf("SELECT COUNT(*) AS total FROM api_tokens WHERE id = 'tok_not_theirs' AND revoked_at IS NULL"),
  ).toBe(1);
  expect(
    await countOf("SELECT COUNT(*) AS total FROM memberships WHERE org_id = ? AND person_id = ?", orgId, "per_arm4_member"),
  ).toBe(0);
  // Their record survives, attributed. History is not a permission.
  expect(await countOf("SELECT COUNT(*) AS total FROM people WHERE id = 'per_arm4_member'")).toBe(1);
});

test("AC-298 · a speaker seat survives the removal of the organizer seat the same human holds", async () => {
  const { cookie, orgId, eventId } = await seedInstance("seattrap");
  await addPerson(orgId, "per_dual", "dual@gl-infra.dev", "Marguerite Osei-Lindqvist");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, NULL, ?, 'ops', ?, ?)",
    ).bind("mem_dual_org", orgId, "per_dual", NOW, NOW),
    env.DB.prepare(
      "INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'speaker', ?, ?)",
    ).bind("mem_dual_speaker", orgId, eventId, "per_dual", NOW, NOW),
  ]);

  expect((await request("/api/v1/org/members/per_dual", { method: "DELETE", headers: { cookie } })).status).toBe(200);
  const left = await env.DB.prepare("SELECT role FROM memberships WHERE person_id = 'per_dual'").all<{ role: string }>();
  expect(left.results.map((row) => row.role)).toEqual(["speaker"]);
});

test("AC-299 · removing a person from a conference ends their work there and leaves published sessions standing", async () => {
  const { cookie, orgId, eventId } = await seedInstance("remove207");
  const other = await seedInstance("keep207");
  await addPerson(orgId, "per_speaker", "wren@gl-infra.dev", "Wren Achebe-Pardo");
  await addPerson(orgId, "per_cospeaker", "co@gl-infra.dev", "Ilya Sandoval-Reyes");
  // The same human is a speaker on someone else's instance too; nothing here
  // may reach across the organization boundary.
  await addPerson(other.orgId, "per_speaker_elsewhere", "wren@gl-infra.dev", "Wren Achebe-Pardo");

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO submissions (id, event_id, kind, title, status, origin, submitter_person_id, is_published, created_at, updated_at)
       VALUES ('sub_live', ?, 'session', 'Taming 40-Minute CI', 'accepted', 'admin', 'per_speaker', 1, ?, ?)`,
    ).bind(eventId, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO submissions (id, event_id, kind, title, status, origin, submitter_person_id, is_published, created_at, updated_at)
       VALUES ('sub_draft', ?, 'session', 'A Session Nobody Published', 'accepted', 'admin', 'per_speaker', 0, ?, ?)`,
    ).bind(eventId, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES ('part_a', 'sub_live', 'per_speaker', 'speaker', 0, ?, ?)",
    ).bind(NOW, NOW),
    env.DB.prepare(
      "INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES ('part_b', 'sub_live', 'per_cospeaker', 'co_speaker', 1, ?, ?)",
    ).bind(NOW, NOW),
    env.DB.prepare(
      "INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES ('part_c', 'sub_draft', 'per_speaker', 'speaker', 0, ?, ?)",
    ).bind(NOW, NOW),
    env.DB.prepare(
      "INSERT INTO task_templates (id, event_id, name, kind, due_offset_days, position, created_at, updated_at) VALUES ('tpl_207', ?, 'Send your bio', 'acknowledge', 7, 0, ?, ?)",
    ).bind(eventId, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, due_at, status, created_at, updated_at)
       VALUES ('task_open', ?, 'per_speaker', 'sub_live', 'tpl_207', 'Send your bio', 'acknowledge', ?, 'open', ?, ?)`,
    ).bind(eventId, DUE_AT, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, due_at, status, completed_at, created_at, updated_at)
       VALUES ('task_done', ?, 'per_speaker', 'sub_live', 'tpl_207', 'Signed the release', 'acknowledge', ?, 'done', ?, ?, ?)`,
    ).bind(eventId, DUE_AT, NOW, NOW, NOW),
    // Org-level person data: notes and tags hang off the person, never off a
    // conference roster row. None of it is this conference's to delete.
    env.DB.prepare(
      "INSERT INTO person_events (id, org_id, person_id, kind, value_json, actor_person_id, created_at) VALUES ('pe_note', ?, 'per_speaker', 'note', '{\"text\":\"met at KubeCon\"}', ?, ?)",
    ).bind(orgId, `per_remove207_owner`, NOW),
  ]);

  const preview = await request(`/api/v1/events/${eventId}/people/per_speaker/removal-preview`, { headers: { cookie } });
  expect(preview.status).toBe(200);
  const previewBody = (await preview.json()) as {
    data: { participations: { title: string; published: boolean; sole_speaker: boolean }[]; open_tasks: number };
  };
  expect(previewBody.data.open_tasks).toBe(1);
  const live = previewBody.data.participations.find((row) => row.title === "Taming 40-Minute CI");
  // The loud warning's raw material: this session is on the public site, and
  // this person is not its only speaker, so removal does not empty it.
  expect(live).toMatchObject({ published: true, sole_speaker: false });
  expect(previewBody.data.participations.find((row) => row.title === "A Session Nobody Published")).toMatchObject({
    published: false,
    sole_speaker: true,
  });

  // Before acting: three participations for this person at this conference, the
  // published session actually published, and the co-speaker present.
  expect(await countOf("SELECT COUNT(*) AS total FROM participations WHERE person_id = 'per_speaker'")).toBe(2);
  expect(await countOf("SELECT COUNT(*) AS total FROM submissions WHERE id = 'sub_live' AND is_published = 1")).toBe(1);
  expect(await countOf("SELECT COUNT(*) AS total FROM participations WHERE person_id = 'per_cospeaker'")).toBe(1);

  const peopleBefore = await countOf("SELECT COUNT(*) AS total FROM people");
  const submissionsBefore = await countOf("SELECT COUNT(*) AS total FROM submissions");
  const annotationsBefore = await countOf("SELECT COUNT(*) AS total FROM person_events WHERE person_id = 'per_speaker'");

  const removed = await request(`/api/v1/events/${eventId}/people/per_speaker/remove`, {
    method: "POST",
    headers: { cookie },
  });
  expect(removed.status).toBe(200);
  expect((await removed.json()) as { data: Record<string, unknown> }).toMatchObject({
    data: { ended_participations: 2, cancelled_tasks: 1, published_sessions_kept: ["Taming 40-Minute CI"] },
  });

  // Gone: their participations at THIS conference, and their open work.
  expect(await countOf("SELECT COUNT(*) AS total FROM participations WHERE person_id = 'per_speaker'")).toBe(0);
  expect(
    await countOf("SELECT COUNT(*) AS total FROM speaker_tasks WHERE id = 'task_open' AND cancelled_at IS NOT NULL"),
  ).toBe(1);
  // Finished work stays finished, and nothing is deleted.
  const done = await env.DB.prepare("SELECT status, completed_at, cancelled_at FROM speaker_tasks WHERE id = 'task_done'")
    .first<{ status: string; completed_at: number; cancelled_at: number | null }>();
  expect(done).toMatchObject({ status: "done", completed_at: NOW, cancelled_at: null });

  // Standing: the published session, its publication, the co-speaker, every
  // person row, every submission, and every org-level annotation.
  expect(await countOf("SELECT COUNT(*) AS total FROM submissions WHERE id = 'sub_live' AND is_published = 1")).toBe(1);
  expect(await countOf("SELECT COUNT(*) AS total FROM participations WHERE person_id = 'per_cospeaker'")).toBe(1);
  expect(await countOf("SELECT COUNT(*) AS total FROM people")).toBe(peopleBefore);
  expect(await countOf("SELECT COUNT(*) AS total FROM submissions")).toBe(submissionsBefore);
  expect(await countOf("SELECT COUNT(*) AS total FROM person_events WHERE person_id = 'per_speaker'")).toBe(
    annotationsBefore,
  );
  // The other organization is untouched, and so is the same-named human on it.
  expect(await countOf("SELECT COUNT(*) AS total FROM people WHERE org_id = ?", other.orgId)).toBe(2);

  // Idempotent: running it again changes nothing and does not resurrect a task.
  const again = await request(`/api/v1/events/${eventId}/people/per_speaker/remove`, { method: "POST", headers: { cookie } });
  expect(again.status).toBe(200);
  expect(
    await countOf("SELECT COUNT(*) AS total FROM speaker_tasks WHERE person_id = 'per_speaker' AND cancelled_at IS NULL AND status = 'open'"),
  ).toBe(0);
});

test("AC-300 · revoking portal access ends the credentials and touches nothing else", async () => {
  const { cookie, orgId, eventId } = await seedInstance("portal207");
  await addPerson(orgId, "per_portal", "cass@gl-infra.dev", "Cass Delacroix-Owens");
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO submissions (id, event_id, kind, title, status, origin, submitter_person_id, is_published, created_at, updated_at)
       VALUES ('sub_portal', ?, 'session', 'Still Speaking', 'accepted', 'admin', 'per_portal', 1, ?, ?)`,
    ).bind(eventId, NOW, NOW),
    env.DB.prepare(
      "INSERT INTO participations (id, submission_id, person_id, role, position, created_at, updated_at) VALUES ('part_portal', 'sub_portal', 'per_portal', 'speaker', 0, ?, ?)",
    ).bind(NOW, NOW),
    env.DB.prepare(
      "INSERT INTO task_templates (id, event_id, name, kind, due_offset_days, position, created_at, updated_at) VALUES ('tpl_portal', ?, 'Send your slides', 'file', 7, 0, ?, ?)",
    ).bind(eventId, NOW, NOW),
    env.DB.prepare(
      `INSERT INTO speaker_tasks (id, event_id, person_id, submission_id, template_id, title, kind, due_at, status, created_at, updated_at)
       VALUES ('task_portal', ?, 'per_portal', 'sub_portal', 'tpl_portal', 'Send your slides', 'file', ?, 'open', ?, ?)`,
    ).bind(eventId, DUE_AT, NOW, NOW),
  ]);
  const theirs = await createSession(env.DB, { personId: "per_portal", userAgent: "mrq-207" });
  const login = await mintMagicLink(env.DB, { personId: "per_portal", purpose: "login" });
  const taskLink = await mintMagicLink(env.DB, { personId: "per_portal", purpose: "task_link" });
  const cospeaker = await mintMagicLink(env.DB, { personId: "per_portal", purpose: "cospeaker_profile" });

  // Before acting: a live session, three unspent links, a participation, and an
  // open task — every row the assertions below are about.
  expect(await countOf("SELECT COUNT(*) AS total FROM auth_sessions WHERE id = ? AND revoked_at IS NULL", theirs.id)).toBe(1);
  expect(
    await countOf("SELECT COUNT(*) AS total FROM magic_links WHERE person_id = 'per_portal' AND used_at IS NULL"),
  ).toBe(3);
  expect(await countOf("SELECT COUNT(*) AS total FROM participations WHERE person_id = 'per_portal'")).toBe(1);
  expect(
    await countOf("SELECT COUNT(*) AS total FROM speaker_tasks WHERE id = 'task_portal' AND status = 'open' AND cancelled_at IS NULL"),
  ).toBe(1);

  const revoked = await request("/api/v1/org/people/per_portal/revoke-access", { method: "POST", headers: { cookie } });
  expect(revoked.status).toBe(200);
  expect((await revoked.json()) as { data: Record<string, number> }).toMatchObject({
    data: { revoked_sessions: 1, consumed_links: 3 },
  });

  expect(
    await countOf("SELECT COUNT(*) AS total FROM auth_sessions WHERE id = ? AND revoked_at IS NULL", theirs.id),
  ).toBe(0);
  for (const link of [login, taskLink, cospeaker]) {
    expect(await countOf("SELECT COUNT(*) AS total FROM magic_links WHERE id = ? AND used_at IS NULL", link.id)).toBe(0);
  }

  // The talk is still happening. This route ends the login, not the speaker.
  expect(await countOf("SELECT COUNT(*) AS total FROM participations WHERE person_id = 'per_portal'")).toBe(1);
  expect(
    await countOf("SELECT COUNT(*) AS total FROM speaker_tasks WHERE id = 'task_portal' AND cancelled_at IS NULL AND status = 'open'"),
  ).toBe(1);
  expect(await countOf("SELECT COUNT(*) AS total FROM submissions WHERE id = 'sub_portal' AND is_published = 1")).toBe(1);
});

test("AC-296 · an unattributable legacy invite is refused rather than minted into whichever organization sorts first", async () => {
  // Two tenants. Org A sorts first, so it is what `resolveOrganization`'s
  // first-row fallback would hand back to anybody who reached it.
  const a = await seedInstance("aaa-tenant");
  const b = await seedInstance("zzz-tenant");
  expect(
    (await env.DB.prepare("SELECT id FROM organizations ORDER BY created_at ASC, id ASC LIMIT 1").first<{ id: string }>())?.id,
  ).toBe(a.orgId);

  // An invite minted before SPEC Amendment 21: a real row, still unspent, with
  // no record of which organization minted it. This is the shape the column was
  // added to fix, and closing the hole only for NEW invites leaves every one of
  // these live.
  const token = "legacy-invite-token-value-for-mrq-207-test";
  await env.DB.prepare(
    `INSERT INTO magic_links (id, token_hash, person_id, purpose, redirect_to, expires_at, used_at, created_at, updated_at)
     VALUES ('ml_legacy_invite', ?, NULL, 'org_invite', '/dashboard', ?, NULL, ?, ?)`,
  )
    .bind(await sha256Hex(token), Date.now() + 7 * 86_400_000, NOW, NOW)
    .run();

  const exchanged = await request("/api/v1/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, purpose: "org_invite", name: "Legacy Recipient", email: "legacy@example.org" }),
  });
  // Refused, and refused in the same words as every other dead link — an invite
  // nobody can attribute to a tenant must not be exchanged into an arbitrary
  // one. Minting into the wrong tenant is the worse answer than refusing.
  expect(exchanged.status).toBe(401);
  expect(await countOf("SELECT COUNT(*) AS total FROM people WHERE email = 'legacy@example.org'")).toBe(0);
  for (const orgId of [a.orgId, b.orgId]) {
    expect(
      await countOf(
        "SELECT COUNT(*) AS total FROM memberships WHERE org_id = ? AND person_id NOT IN (SELECT id FROM people WHERE email LIKE 'sam+%')",
        orgId,
      ),
    ).toBe(0);
  }
});

test("AC-296 · one organization's admin can neither see nor revoke another's pending invites", async () => {
  const a = await seedInstance("tenant-a");
  const b = await seedInstance("tenant-b");

  const mintedForB = await request("/api/v1/org/invites", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: b.cookie },
    body: JSON.stringify({ role: "ops" }),
  });
  expect(mintedForB.status).toBe(201);
  const bInvite = (await mintedForB.json()) as { data: { id: string } };

  const mintedForA = await request("/api/v1/org/invites", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: a.cookie },
    body: JSON.stringify({ role: "ops" }),
  });
  const aInvite = (await mintedForA.json()) as { data: { id: string } };

  // Enumeration: A's list is A's. Seeing that B has a pending invite at all is
  // information disclosure across a tenant boundary, and it needs no special
  // access — only the admin role A legitimately holds in its own organization.
  const listed = await request("/api/v1/org/invites", { headers: { cookie: a.cookie } });
  const listedIds = ((await listed.json()) as { data: { id: string }[] }).data.map((row) => row.id);
  expect(listedIds).toEqual([aInvite.data.id]);
  expect(listedIds).not.toContain(bInvite.data.id);

  // Destruction: and A cannot spend B's invite by naming its id. The refusal
  // must not distinguish "not yours" from "does not exist".
  const revoked = await request(`/api/v1/org/invites/${bInvite.data.id}`, {
    method: "DELETE",
    headers: { cookie: a.cookie },
  });
  expect(revoked.status).toBe(404);
  expect(
    await countOf("SELECT COUNT(*) AS total FROM magic_links WHERE id = ? AND used_at IS NULL", bInvite.data.id),
  ).toBe(1);

  // B's own admin still can, so the scoping narrowed nothing it should not.
  expect(
    (await request(`/api/v1/org/invites/${bInvite.data.id}`, { method: "DELETE", headers: { cookie: b.cookie } })).status,
  ).toBe(200);
});

test("AC-296 · a live conference-scoped invite does not make its conference undeletable", async () => {
  const { cookie, orgId, eventId } = await seedInstance("del207");

  const minted = await request("/api/v1/org/invites", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ role: "ops", event_id: eventId }),
  });
  expect(minted.status).toBe(201);
  const invite = (await minted.json()) as { data: { id: string } };
  // The row the deletion cascade has to know about: it references the event
  // through `invite_event_id`, which is this ticket's column, while the
  // cascade was written against `event_id`. Nothing else in the schema points
  // at the conference from here.
  expect(
    await countOf(
      "SELECT COUNT(*) AS total FROM magic_links WHERE id = ? AND invite_event_id = ? AND event_id IS NULL",
      invite.data.id,
      eventId,
    ),
  ).toBe(1);

  // Deleting the conference must still work. Left unhandled this is not a
  // partial cascade — it is a FOREIGN KEY failure that makes the conference
  // permanently undeletable while one invite is outstanding.
  const deleted = await request(`/api/v1/events/${eventId}`, { method: "DELETE", headers: { cookie } });
  expect(deleted.status).toBe(200);
  expect(await countOf("SELECT COUNT(*) AS total FROM events WHERE id = ?", eventId)).toBe(0);
  // And the invite goes with it: a seat scoped to a conference that no longer
  // exists is not a seat anyone should be able to exchange.
  expect(await countOf("SELECT COUNT(*) AS total FROM magic_links WHERE id = ?", invite.data.id)).toBe(0);
  // The organization itself is untouched — only the conference was deleted.
  expect(await countOf("SELECT COUNT(*) AS total FROM organizations WHERE id = ?", orgId)).toBe(1);
});

test("AC-298 · the ordinary removal — the one the UI sends — kills the removed organizer's credential, proven by using it", async () => {
  const { cookie, orgId } = await seedInstance("bearer207");
  await addPerson(orgId, "per_bearer_member", "kai@gl-infra.dev", "Kai Brennan-Oduya");
  await env.DB.prepare(
    "INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, NULL, ?, 'program_lead', ?, ?)",
  )
    .bind("mem_bearer", orgId, "per_bearer_member", NOW, NOW)
    .run();

  // A credential this organizer minted, and whose secret they therefore know by
  // heart. `created_by` is them; nothing else about the row is.
  const secret = "mq_bearer_secret_for_mrq_207_regression";
  await env.DB.prepare(
    `INSERT INTO api_tokens (id, org_id, event_id, name, token_hash, prefix, scopes, created_by, created_at, updated_at)
     VALUES ('tok_bearer', ?, NULL, 'their integration', ?, 'mq_bear', '{"permissions":["program:read"],"event_ids":[]}', 'per_bearer_member', ?, ?)`,
  )
    .bind(orgId, await sha256Hex(secret), NOW, NOW)
    .run();

  const bearer = { authorization: `Bearer ${secret}` };
  // Before: the credential works. Without this the assertion below could pass
  // against a token that never authenticated in the first place.
  expect((await request("/api/v1/org/members", { headers: bearer })).status).toBe(200);

  // The request the product actually sends: DELETE with NO BODY. Every
  // assertion in this file that passed explicit token ids exercised the
  // revocation helper while never touching this path.
  const removed = await request("/api/v1/org/members/per_bearer_member", {
    method: "DELETE",
    headers: { cookie },
  });
  expect(removed.status).toBe(200);
  expect((await removed.json()) as { data: { revoked_tokens: number } }).toMatchObject({
    data: { revoked_tokens: 1 },
  });

  // After: the credential is dead. Asserting the ROW is revoked is weaker than
  // proving the secret no longer authenticates, which is the thing a removed
  // organizer would actually try.
  expect((await request("/api/v1/org/members", { headers: bearer })).status).toBe(401);
  expect(
    await countOf("SELECT COUNT(*) AS total FROM api_tokens WHERE id = 'tok_bearer' AND revoked_at IS NOT NULL"),
  ).toBe(1);
});

test("AC-298 · a token the human explicitly keeps survives removal, and it is the only one that does", async () => {
  const { cookie, orgId } = await seedInstance("keep207");
  await addPerson(orgId, "per_keep_member", "sim@gl-infra.dev", "Simone Adeyemi-Frost");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO memberships (id, org_id, event_id, person_id, role, created_at, updated_at) VALUES (?, ?, NULL, ?, 'ops', ?, ?)",
    ).bind("mem_keep", orgId, "per_keep_member", NOW, NOW),
    ...["tok_keep_this", "tok_kill_this"].map((id) =>
      env.DB.prepare(
        `INSERT INTO api_tokens (id, org_id, event_id, name, token_hash, prefix, scopes, created_by, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, 'mq_test', '{"permissions":["program:read"],"event_ids":[]}', 'per_keep_member', ?, ?)`,
      ).bind(id, orgId, id, `hash_${id}`, NOW, NOW),
    ),
  ]);
  expect(await countOf("SELECT COUNT(*) AS total FROM api_tokens WHERE revoked_at IS NULL")).toBe(2);

  // Ruling O3's dialog: revoke is the DEFAULT, and the human unchecks the one
  // that powers an integration the organization keeps. Keeping is the explicit
  // act; revoking is what happens if nobody says anything.
  const removed = await request("/api/v1/org/members/per_keep_member", {
    method: "DELETE",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ keep_token_ids: ["tok_keep_this"] }),
  });
  expect(removed.status).toBe(200);
  expect((await removed.json()) as { data: { revoked_tokens: number } }).toMatchObject({
    data: { revoked_tokens: 1 },
  });

  const tokens = await env.DB.prepare("SELECT id, revoked_at FROM api_tokens ORDER BY id").all<{ id: string; revoked_at: number | null }>();
  const state = new Map(tokens.results.map((row) => [row.id, row.revoked_at]));
  expect(state.get("tok_keep_this")).toBeNull();
  expect(state.get("tok_kill_this")).not.toBeNull();
});
