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

  assert.deepEqual(
    projectionCalls,
    [
      { file: "src/routes/portal.routes.ts", line: 509 },
      { file: "src/routes/portal.routes.ts", line: 737 },
      { file: "src/routes/public-form.shared.ts", line: 313 },
      { file: "src/ui/public/form/PublicForm.tsx", line: 116 },
    ],
    "projection call-site inventory changed; re-audit every consumer before adding or moving a writer",
  );
  assert.deepEqual(
    directAnswerWriters,
    [
      { file: "src/lib/sessionize-import.ts", line: 697 },
      { file: "src/lib/sessionize-import.ts", line: 790 },
      { file: "src/routes/portal.routes.ts", line: 755 },
      { file: "src/routes/public-form.shared.ts", line: 351 },
      { file: "src/routes/submission-record.routes.ts", line: 543 },
      { file: "src/routes/submission-record.routes.ts", line: 635 },
    ],
    "direct submission-answer writer inventory changed; re-audit evaluator coverage and trusted-import exceptions",
  );

  // Positive controls: the inventory must contain both the shared projected
  // writer and the known admin-route exception under audit.
  assert.ok(directAnswerWriters.some((writer) => writer.file === "src/routes/public-form.shared.ts"));
  assert.equal(
    directAnswerWriters.filter((writer) => writer.file === "src/routes/submission-record.routes.ts").length,
    2,
  );
});
