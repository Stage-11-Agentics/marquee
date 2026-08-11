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

function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function tally(calls) {
  const byFile = new Map();
  for (const call of calls) byFile.set(call.file, (byFile.get(call.file) ?? 0) + 1);
  return [...byFile.entries()].map(([file, count]) => ({ file, count })).sort((a, b) => a.file.localeCompare(b.file));
}

test("CONTRACT · public answer projection and direct answer writers have an explicit AST inventory", async () => {
  const modules = await sourceModules();
  const projectionCalls = [];
  const directAnswerWriters = [];

  for (const module of modules) {
    const sourceFile = ts.createSourceFile(module.absolute, module.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    walk(sourceFile, (node) => {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "projectApplicableAnswers") {
        projectionCalls.push({ file: module.path, line });
      }

      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== "prepare") return;
      const sql = literalText(node.arguments[0]);
      if (sql === null || !sql.toUpperCase().includes("INSERT INTO SUBMISSION_ANSWERS")) return;
      directAnswerWriters.push({ file: module.path, line });
    });
  }

  // Keyed on file and count, never on line numbers: an unrelated edit above a
  // call site shifts every line below it, and a guard that fails on drift gets
  // silenced rather than heeded. The invariant worth holding is WHICH modules
  // project answers and HOW MANY times, not where in the file they sit.
  assert.deepEqual(
    tally(projectionCalls),
    [
      { file: "src/routes/portal.routes.ts", count: 2 },
      { file: "src/routes/public-form.shared.ts", count: 1 },
      { file: "src/routes/submission-record.routes.ts", count: 1 },
      { file: "src/ui/public/form/PublicForm.tsx", count: 1 },
    ],
    "projection call-site inventory changed; re-audit every consumer before adding or moving a writer. Observed: "
      + JSON.stringify(projectionCalls),
  );
  assert.deepEqual(
    tally(directAnswerWriters),
    [
      { file: "src/lib/sessionize-import.ts", count: 2 },
      { file: "src/routes/portal.routes.ts", count: 1 },
      { file: "src/routes/public-form.shared.ts", count: 1 },
      { file: "src/routes/submission-record.routes.ts", count: 2 },
    ],
    "direct submission-answer writer inventory changed; re-audit evaluator coverage and trusted-import exceptions. Observed: "
      + JSON.stringify(directAnswerWriters),
  );

  // Positive controls: the inventory must contain both the shared projected
  // writer and the known admin-route exception under audit.
  assert.ok(directAnswerWriters.some((writer) => writer.file === "src/routes/public-form.shared.ts"));
  assert.equal(
    directAnswerWriters.filter((writer) => writer.file === "src/routes/submission-record.routes.ts").length,
    2,
  );
});
