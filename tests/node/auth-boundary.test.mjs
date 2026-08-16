import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript-ast";

const root = resolve(import.meta.dirname, "../..");

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

async function sourceModules() {
  const paths = (await readdir(resolve(root, "src"), { recursive: true }))
    .filter((path) => path.match(/\.(?:ts|tsx)$/) !== null)
    .sort();
  return Promise.all(paths.map(async (path) => ({
    path: `src/${path}`,
    absolute: resolve(root, "src", path),
    source: await readFile(resolve(root, "src", path), "utf8"),
  })));
}

function callSites(module, name) {
  const sourceFile = ts.createSourceFile(
    module.absolute,
    module.source,
    ts.ScriptTarget.Latest,
    true,
    module.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const sites = [];
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== name) return;
    sites.push({ file: module.path, line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1 });
  });
  return sites;
}

test("CONTRACT · A-5 has one enumerated session writer path and cookie-safe embeds", async () => {
  const modules = await sourceModules();
  const sessionCalls = modules.flatMap((module) => callSites(module, "createSession"));
  const cookieCalls = modules.flatMap((module) => callSites(module, "setSessionCookie"));
  const magicMintCalls = modules.flatMap((module) => callSites(module, "mintMagicLink"));
  // The status-aware consumer is the same single-use seam: it preserves the
  // reason for a rejection so a browser can tell expiry from replay without
  // adding another token writer or consumer path.
  const magicConsumeCalls = modules.flatMap((module) => [
    ...callSites(module, "consumeMagicLink"),
    ...callSites(module, "consumeMagicLinkWithStatus"),
  ]);

  // Positive controls: every intended issuer must remain present before the
  // count can pass. The cold start widened this set deliberately — a claim or
  // an organizer invite mints a session from a token that predates its person —
  // and `instance-claim.ts` is the ONE implementation of that, which is what
  // AC-282's "the exchange path is the claim exchange path" asserts.
  // The fourth is the typed demo address (`organizer@demo.com` and siblings) on
  // the sign-in form. It is enumerated rather than excused for the same reason
  // as the others: it mints no new kind of credential and opens no seat the
  // one-click demo door does not already open — same `findDemoPersona`, same
  // `demo_mode = 1` gate, and it resolves to null on any instance without a
  // seeded demo, where the address is answered exactly like an address nobody
  // registered. A demo-only alias of an existing issuer is what A-5 permits; a
  // second way to become somebody is what it forbids.
  assert.equal(sessionCalls.length, 4, JSON.stringify(sessionCalls));
  assert.deepEqual(sessionCalls.map(({ file }) => file), [
    "src/lib/auth/instance-claim.ts",
    "src/routes/auth.routes.ts",
    "src/routes/auth.routes.ts",
    "src/routes/auth.routes.ts",
  ]);
  // The fourth `auth.routes.ts` cookie write is `exit-preview` (SPK-07). It is
  // the ONLY writer here that mints nothing: it hands back a session that
  // already exists, the one an organizer was unseated from when they opened a
  // speaker's portal. A browser holds one `mq_session`, so becoming the speaker
  // necessarily displaces them from every tab; without a way back the preview
  // is a one-way door out of the organizer's own seat.
  //
  // It is enumerated rather than excused because a route that sets a cookie to
  // a session id is exactly the shape A-5 watches. What keeps it from being a
  // session-swap primitive is that it reads the target from the CALLING
  // session's own `portal_preview:` hint — a marker only the exchange writes,
  // only for a link the mint already proved was an organizer's — refuses any
  // session without one, and revokes the preview seat on the way out. Note the
  // session-writer count above is unchanged: the preview is a condition on the
  // existing issuer, not a new one.
  assert.deepEqual(cookieCalls.map(({ file }) => file).sort(), [
    "src/index.ts",
    "src/routes/auth.routes.ts",
    "src/routes/auth.routes.ts",
    "src/routes/auth.routes.ts",
    "src/routes/auth.routes.ts",
    "src/routes/claim.routes.ts",
  ]);
  // The third issuer is the reviewer invitation (MRQ-107, eval §T-A). It is
  // enumerated here rather than excused: an organizer provisioning a reviewer
  // has to hand them a way in, and the alternative — a second credential path
  // beside magic links — is the outcome A-5 exists to prevent. It reuses the
  // same `purpose: "login"` mint, behind `requireProgram(..., write)`, and
  // refuses any address that resolves to a program-staff seat.
  // The fourth issuer is the draft-close reminder (MRQ-247). It is enumerated
  // here rather than excused: the hourly scheduler mints a person-bound,
  // submission-bound public-form capability so a speaker can return to one
  // saved draft. It never enters the session-producing exchange — the
  // `draft_resume` purpose is deliberately absent there — and the public-form
  // resolver re-binds event, form, submission, and submitter from the
  // server-minted redirect before it returns a record. Its purpose and exact
  // redirect are positive-controlled below; this is a new credential path and
  // must stay visible to A-5 reviewers.
  assert.deepEqual(magicMintCalls.map(({ file }) => file).sort(), [
    "src/jobs/mail/triggers.ts",
    "src/lib/auth/instance-claim.ts",
    "src/lib/auth/instance-claim.ts",
    "src/routes/auth.routes.ts",
    "src/routes/evaluation.routes.ts",
    "src/routes/public-form.routes.ts",
  ]);
  const mailTriggers = modules.find(({ path }) => path === "src/jobs/mail/triggers.ts");
  assert.ok(mailTriggers);
  assert.match(mailTriggers.source, /purpose: "draft_resume"/);
  assert.match(mailTriggers.source, /redirectTo: draftResumeRedirectTo\(candidate\.formSlug, candidate\.submissionId\)/);
  const evaluationRoutes = modules.find(({ path }) => path === "src/routes/evaluation.routes.ts");
  assert.ok(evaluationRoutes);
  // The invitation may only mint for someone who holds no program-staff role,
  // because exchanging a link opens every membership its person carries.
  assert.match(evaluationRoutes.source, /role IN \('owner', 'program_lead', 'ops'\)/);
  assert.match(evaluationRoutes.source, /purpose: "login", redirectTo: "\/reviewer"/);
  assert.deepEqual(magicConsumeCalls.map(({ file }) => file), [
    "src/lib/auth/instance-claim.ts",
    "src/routes/auth.routes.ts",
  ]);

  const sessionSource = await readFile(resolve(root, "src/lib/auth/auth-sessions.ts"), "utf8");
  assert.equal((sessionSource.match(/INSERT\s+INTO\s+auth_sessions/gi) ?? []).length, 1);
  assert.equal((sessionSource.match(/UPDATE\s+auth_sessions/gi) ?? []).length, 1);
  assert.doesNotMatch(sessionSource, /UPDATE\s+auth_sessions\s+SET[^;`]*expires_at\s*=/i);

  const authRoutes = modules.find(({ path }) => path === "src/routes/auth.routes.ts");
  const publicFormRoutes = modules.find(({ path }) => path === "src/routes/public-form.routes.ts");
  assert.ok(authRoutes);
  assert.ok(publicFormRoutes);
  assert.match(authRoutes.source, /path: "\/api\/v1\/auth\/demo"/);
  assert.match(authRoutes.source, /path: "\/api\/v1\/auth\/exchange"/);
  assert.match(publicFormRoutes.source, /if \(event\.demo_mode === 1\) \{[\s\S]{0,300}mintMagicLink/);

  const cookies = modules.find(({ path }) => path === "src/lib/cookies.ts");
  assert.ok(cookies);
  assert.match(cookies.source, /httpOnly:\s*true/);
  assert.match(cookies.source, /secure:\s*true/);
  assert.match(cookies.source, /sameSite:\s*"Lax"/);
  assert.match(cookies.source, /path:\s*"\/"/);
  assert.doesNotMatch(cookies.source, /domain\s*:/i);

  const embed = modules.find(({ path }) => path === "src/routes/embed.route.tsx");
  const publicRoutes = modules.find(({ path }) => path === "src/routes/public.routes.ts");
  assert.ok(embed);
  assert.ok(publicRoutes);
  assert.match(embed.source, /embedRoutes\.get\("\/embed\/:slug"/);
  for (const forbidden of [/mq_session/, /getCookie/, /resolveAuth/, /auth-middleware/, /lib\/cookies/]) {
    assert.doesNotMatch(embed.source, forbidden);
  }
  assert.match(publicRoutes.source, /path: "\/api\/v1\/public\/embeds\/{slug}"/);
  assert.match(publicRoutes.source, /policy: \{ auth: \{ kind: "public" \}/);
});
