import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript-ast";

const root = resolve(import.meta.dirname, "../..");

async function sourceModules() {
  const paths = (await readdir(resolve(root, "src"), { recursive: true }))
    .filter((path) => path.match(/\.(?:ts|tsx)$/) !== null)
    .sort();
  return Promise.all(paths.map(async (path) => ({
    path: "src/" + path,
    absolute: resolve(root, "src", path),
    source: await readFile(resolve(root, "src", path), "utf8"),
  })));
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

test("AC-250 · comms has one send route, one provider module, and exactly two live-policy writes", async () => {
  const source = await readFile(resolve(root, "src/routes/comms.routes.ts"), "utf8");
  assert.equal((source.match(/path: \"\/api\/v1\/events\/\{eventId\}\/comms\/send\"/g) ?? []).length, 1);
  assert.doesNotMatch(source, /\/messages\/send/);
  assert.doesNotMatch(source, /fetch\(\"https:\/\/api\.resend\.com/);

  const modules = await sourceModules();
  const providerImports = [];
  const providerEndpointRefs = [];
  const insertCalls = [];
  const livePolicyCalls = [];
  for (const module of modules) {
    if (module.source.includes("api.resend.com")) providerEndpointRefs.push(module.path);
    const sourceFile = ts.createSourceFile(module.absolute, module.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    walk(sourceFile, (node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.match(/resend/i) !== null) {
        providerImports.push(module.path);
      }
      if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== "insertOutbox") return;
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      insertCalls.push({ file: module.path, line, arity: node.arguments.length });
      const [input, policy] = node.arguments;
      if (
        node.arguments.length === 2 &&
        ts.isIdentifier(input) &&
        input.text === "input" &&
        ts.isStringLiteral(policy) &&
        policy.text === "always_live"
      ) {
        livePolicyCalls.push({ file: module.path, line });
      }
    });
  }

  assert.deepEqual(providerImports, [], "no production module imports a Resend client");
  assert.deepEqual(providerEndpointRefs, ["src/jobs/mail/consumer.ts"], "only the consumer references the Resend endpoint");
  assert.equal(insertCalls.length, 3, "unexpected insertOutbox call inventory: " + JSON.stringify(insertCalls));
  assert.deepEqual(insertCalls.map((call) => call.arity).sort((a, b) => a - b), [1, 2, 2]);
  assert.equal(livePolicyCalls.length, 2, "unexpected live-policy call inventory: " + JSON.stringify(livePolicyCalls));
  assert.ok(livePolicyCalls.every((call) => call.file === "src/jobs/mail/outbox.ts"));
});
