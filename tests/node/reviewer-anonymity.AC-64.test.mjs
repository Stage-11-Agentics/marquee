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
    path: `src/${path}`,
    absolute: resolve(root, "src", path),
    source: await readFile(resolve(root, "src", path), "utf8"),
  })));
}

function walk(node, visit, ancestors = []) {
  visit(node, ancestors);
  ts.forEachChild(node, (child) => walk(child, visit, [...ancestors, node]));
}

function callName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

function objectProperty(object, name) {
  if (!ts.isObjectLiteralExpression(object)) return undefined;
  return object.properties.find((property) =>
    ts.isPropertyAssignment(property)
    && ((ts.isIdentifier(property.name) && property.name.text === name)
      || (ts.isStringLiteral(property.name) && property.name.text === name))
  );
}

function stringProperty(object, name) {
  const property = objectProperty(object, name);
  if (!property || !ts.isPropertyAssignment(property)) return undefined;
  return ts.isStringLiteral(property.initializer) || ts.isNoSubstitutionTemplateLiteral(property.initializer)
    ? property.initializer.text
    : undefined;
}

function stringArrayProperty(object, name) {
  const property = objectProperty(object, name);
  if (!property || !ts.isPropertyAssignment(property) || !ts.isArrayLiteralExpression(property.initializer)) return [];
  return property.initializer.elements.flatMap((element) =>
    ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element) ? [element.text] : []
  );
}

function lineFor(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function isAnonymizedNullBranch(ancestors) {
  const awaitNode = ancestors.at(-1);
  const conditional = ancestors.at(-2);
  if (!awaitNode || !conditional || !ts.isAwaitExpression(awaitNode) || !ts.isConditionalExpression(conditional)) return false;
  if (conditional.whenTrue.kind !== ts.SyntaxKind.NullKeyword) return false;
  const condition = conditional.condition;
  return ts.isPropertyAccessExpression(condition)
    && ts.isIdentifier(condition.expression)
    && condition.expression.text === "round"
    && condition.name.text === "anonymized";
}

test("AC-64 · AST inventory covers every Reviewer manifest route and guards the blind identity branch", async () => {
  const expected = [
    "GET /api/v1/events/{eventId}/reviewer/queue getReviewerQueueContext",
    "GET /api/v1/events/{eventId}/rounds/{roundId}/comparisons/next getReviewerComparisonQueue",
    "GET /api/v1/events/{eventId}/rounds/{roundId}/export exportReviewerQueue",
    "GET /api/v1/events/{eventId}/rounds/{roundId}/queue getReviewerQueue",
    "GET /api/v1/events/{eventId}/rounds/{roundId}/submissions/{submissionId} getReviewerSubmission",
    "GET /api/v1/events/{eventId}/rounds/{roundId}/submissions/{submissionId}/files getReviewerSubmissionFiles",
    "POST /api/v1/events/{eventId}/rounds/{roundId}/comparisons writeReviewerComparison",
    "POST /api/v1/events/{eventId}/rounds/{roundId}/submissions/{submissionId}/evaluations writeReviewerEvaluation",
  ].sort();
  const modules = await sourceModules();
  const reviewerRoutes = [];
  const identityCalls = [];

  for (const module of modules) {
    const sourceFile = ts.createSourceFile(module.absolute, module.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    assert.equal(sourceFile.parseDiagnostics.length, 0, `AST parse failed for ${module.path}`);
    walk(sourceFile, (node) => {
      if (ts.isCallExpression(node) && callName(node.expression) === "identityForSubmission") {
        identityCalls.push({ file: module.path, line: lineFor(sourceFile, node) });
      }
      if (!ts.isCallExpression(node) || callName(node.expression) !== "defineApiRoute") return;
      const definition = node.arguments[0];
      if (!ts.isObjectLiteralExpression(definition)) return;
      const tags = stringArrayProperty(definition, "tags");
      if (!tags.includes("Reviewer")) return;
      const method = stringProperty(definition, "method");
      const path = stringProperty(definition, "path");
      const operationId = stringProperty(definition, "operationId");
      assert.ok(method && path && operationId, `incomplete Reviewer route in ${module.path}:${lineFor(sourceFile, node)}`);
      reviewerRoutes.push({
        file: module.path,
        line: lineFor(sourceFile, node),
        signature: `${method.toUpperCase()} ${path} ${operationId}`,
      });
      const handler = node.arguments[1];
      if (!handler) return;
      walk(handler, (handlerNode, ancestors) => {
        if (ts.isCallExpression(handlerNode) && callName(handlerNode.expression) === "identityForSubmission") {
          assert.ok(
            isAnonymizedNullBranch(ancestors),
            `identityForSubmission must be null-selected when round.anonymized at ${module.path}:${lineFor(sourceFile, handlerNode)}`,
          );
        }
      });
    });
  }

  assert.deepEqual(reviewerRoutes.map((route) => route.signature).sort(), expected);
  assert.ok(reviewerRoutes.every((route) => route.file === "src/routes/review.routes.ts"));
  assert.deepEqual(identityCalls.map((call) => call.file), ["src/routes/review.routes.ts"]);
  assert.equal(identityCalls.length, 1, `unexpected identity query call inventory: ${JSON.stringify(identityCalls)}`);
});
