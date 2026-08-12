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
  const magicConsumeCalls = modules.flatMap((module) => callSites(module, "consumeMagicLink"));

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
  assert.deepEqual(cookieCalls.map(({ file }) => file).sort(), [
    "src/index.ts",
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
  assert.deepEqual(magicMintCalls.map(({ file }) => file).sort(), [
    "src/lib/auth/instance-claim.ts",
    "src/lib/auth/instance-claim.ts",
    "src/routes/auth.routes.ts",
    "src/routes/evaluation.routes.ts",
    "src/routes/public-form.routes.ts",
  ]);
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
