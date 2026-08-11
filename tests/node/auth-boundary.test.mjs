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

  // Positive controls: both intended issuers must remain present before the count can pass.
  assert.equal(sessionCalls.length, 2, JSON.stringify(sessionCalls));
  assert.deepEqual(sessionCalls.map(({ file }) => file), [
    "src/routes/auth.routes.ts",
    "src/routes/auth.routes.ts",
  ]);
  assert.deepEqual(cookieCalls.map(({ file }) => file).sort(), [
    "src/index.ts",
    "src/routes/auth.routes.ts",
    "src/routes/auth.routes.ts",
  ]);
  assert.deepEqual(magicMintCalls.map(({ file }) => file).sort(), [
    "src/routes/auth.routes.ts",
    "src/routes/public-form.routes.ts",
  ]);
  assert.deepEqual(magicConsumeCalls.map(({ file }) => file), ["src/routes/auth.routes.ts"]);

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
