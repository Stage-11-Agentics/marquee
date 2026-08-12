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

function property(object, name) {
  if (!ts.isObjectLiteralExpression(object)) return null;
  return object.properties.find((candidate) => {
    if (!ts.isPropertyAssignment(candidate)) return false;
    const candidateName = candidate.name;
    return (ts.isIdentifier(candidateName) || ts.isStringLiteral(candidateName)) && candidateName.text === name;
  }) ?? null;
}

function stringValue(node) {
  if (!node || !ts.isPropertyAssignment(node)) return null;
  return ts.isStringLiteral(node.initializer) ? node.initializer.text : null;
}

function stringArrayValue(node) {
  if (!node || !ts.isPropertyAssignment(node) || !ts.isArrayLiteralExpression(node.initializer)) return [];
  return node.initializer.elements
    .filter((element) => ts.isStringLiteral(element))
    .map((element) => element.text);
}

function callNames(node) {
  const names = [];
  walk(node, (candidate) => {
    if (ts.isCallExpression(candidate) && ts.isIdentifier(candidate.expression)) names.push(candidate.expression.text);
  });
  return names;
}

function callSites(sourceFile, name) {
  const sites = [];
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== name) return;
    sites.push({ line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1 });
  });
  return sites;
}

function functionBody(sourceFile, name) {
  let body = null;
  walk(sourceFile, (node) => {
    if (body !== null || !ts.isFunctionDeclaration(node) || !node.name || node.name.text !== name) return;
    body = node.getText(sourceFile);
  });
  return body;
}

function routeDefinitions(module) {
  const sourceFile = ts.createSourceFile(module.path, module.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const routes = [];
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== "defineApiRoute") return;
    const config = node.arguments[0];
    const handler = node.arguments[1];
    const policy = property(config, "policy");
    routes.push({
      file: module.path,
      handler,
      handlerCalls: handler ? callNames(handler) : [],
      method: stringValue(property(config, "method")),
      operationId: stringValue(property(config, "operationId")),
      path: stringValue(property(config, "path")),
      policy: policy?.getText(sourceFile) ?? "",
      source: node.getText(sourceFile),
      tags: stringArrayValue(property(config, "tags")),
    });
  });
  return { routes, sourceFile };
}

async function routeModules() {
  const paths = (await readdir(resolve(root, "src/routes"), { recursive: true }))
    .filter((path) => path.endsWith(".routes.ts"))
    .sort();
  return Promise.all(paths.map(async (path) => ({
    path: `src/routes/${path}`,
    absolute: resolve(root, "src/routes", path),
    source: await readFile(resolve(root, "src/routes", path), "utf8"),
  })));
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

const expectedReviewerRoutes = [
  ["getReviewerQueue", "get", "/api/v1/events/{eventId}/rounds/{roundId}/queue"],
  ["getReviewerQueueContext", "get", "/api/v1/events/{eventId}/reviewer/queue"],
  ["getReviewerComparisonQueue", "get", "/api/v1/events/{eventId}/rounds/{roundId}/comparisons/next"],
  ["writeReviewerComparison", "post", "/api/v1/events/{eventId}/rounds/{roundId}/comparisons"],
  ["getReviewerSubmission", "get", "/api/v1/events/{eventId}/rounds/{roundId}/submissions/{submissionId}"],
  ["getReviewerSubmissionFiles", "get", "/api/v1/events/{eventId}/rounds/{roundId}/submissions/{submissionId}/files"],
  ["exportReviewerQueue", "get", "/api/v1/events/{eventId}/rounds/{roundId}/export"],
  ["writeReviewerEvaluation", "post", "/api/v1/events/{eventId}/rounds/{roundId}/submissions/{submissionId}/evaluations"],
];

test("CONTRACT · the manifest has one guarded reviewer inventory and guarded writers", async () => {
  const manifest = await readFile(resolve(root, "src/routes/_manifest.ts"), "utf8");
  assert.match(manifest, /import\.meta\.glob\("\.\/\*\*\/\*\.routes\.ts",\s*\{ eager: true \}/);

  const modules = await routeModules();
  const parsedModules = modules.map((module) => ({ module, ...routeDefinitions(module) }));
  const allModules = await sourceModules();
  const allRoutes = parsedModules.flatMap(({ routes }) => routes);
  const reviewerRoutes = allRoutes.filter((route) => route.tags.includes("Reviewer"));
  const reviewGrantRoutes = allRoutes.filter((route) => route.policy.includes('grants: ["review:write"]'));
  const inventory = reviewerRoutes.map(({ operationId, method, path }) => [operationId, method, path]);

  // Positive controls: both read and write families must be present before
  // the inventory assertions can pass.
  assert.equal(reviewerRoutes.length, expectedReviewerRoutes.length, JSON.stringify(inventory));
  assert.deepEqual(inventory, expectedReviewerRoutes);
  assert.deepEqual(reviewGrantRoutes.map(({ operationId }) => operationId), expectedReviewerRoutes.map(([operationId]) => operationId));
  assert.ok(reviewerRoutes.some(({ method }) => method === "get"));
  assert.ok(reviewerRoutes.some(({ method }) => method === "post"));
  assert.deepEqual([...new Set(reviewerRoutes.map(({ file }) => file))], ["src/routes/review.routes.ts"]);

  const reviewerGuardNames = {
    getReviewerQueue: "reviewerQueuePayload",
    getReviewerQueueContext: "reviewerQueuePayload",
    getReviewerComparisonQueue: "comparisonQueuePayload",
    writeReviewerComparison: "authorizeReviewerScope",
    getReviewerSubmission: "authorizeReviewerScope",
    getReviewerSubmissionFiles: "authorizeReviewerScope",
    exportReviewerQueue: "reviewerQueue",
    writeReviewerEvaluation: "authorizeReviewerScope",
  };
  for (const route of reviewerRoutes) {
    const guard = reviewerGuardNames[route.operationId];
    assert.ok(guard, `unreviewed reviewer operation ${route.operationId}`);
    assert.ok(route.handlerCalls.includes(guard), `${route.operationId} does not call ${guard}`);
    assert.match(route.policy, /review:write/);
  }

  const reviewModule = parsedModules.find(({ module }) => module.path === "src/routes/review.routes.ts");
  assert.ok(reviewModule);
  const reviewerQueueBody = functionBody(reviewModule.sourceFile, "reviewerQueue");
  assert.ok(reviewerQueueBody, "missing reviewer helper reviewerQueue");
  assert.match(reviewerQueueBody, /authorizeReviewerQueueScope/);
  for (const helper of ["reviewerQueuePayload", "comparisonQueuePayload"]) {
    const body = functionBody(reviewModule.sourceFile, helper);
    assert.ok(body, `missing reviewer helper ${helper}`);
    assert.match(body, helper === "reviewerQueuePayload" ? /reviewerQueue/ : /authorizeReviewerQueueScope/);
  }
  for (const writer of ["writeReviewerComparison", "writeReviewerEvaluation"]) {
    const route = reviewerRoutes.find(({ operationId }) => operationId === writer);
    assert.ok(route);
    assert.match(route.source, writer.endsWith("Comparison") ? /INSERT\s+INTO\s+comparisons/i : /INSERT\s+INTO\s+evaluations/i);
    assert.ok(route.handlerCalls.includes("authorizeReviewerScope"));
  }

  const scopeSource = await readFile(resolve(root, "src/lib/reviewer-scope.ts"), "utf8");
  assert.match(scopeSource, /scope\.event_id\s*=\s*submission\.event_id/);
  assert.match(scopeSource, /committee\.event_id\s*=\s*submission\.event_id/);
  assert.match(scopeSource, /submission\.event_id\s*=\s*\?/);
  assert.match(scopeSource, /reviewerCanBeAssignedToSubmission/);
  const migration = await readFile(resolve(root, "migrations/0001_init.sql"), "utf8");
  assert.match(migration, /CHECK\s*\(role\s*<>\s*'reviewer'\s+OR\s+event_id\s+IS\s+NOT\s+NULL\)/);

  const authSource = await readFile(resolve(root, "src/lib/auth/auth-middleware.ts"), "utf8");
  const authSourceFile = ts.createSourceFile("src/lib/auth/auth-middleware.ts", authSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const membershipLoads = [];
  walk(authSourceFile, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return;
    if (node.expression.text !== "loadMembershipsForOrg" && node.expression.text !== "loadMemberships") return;
    membershipLoads.push({ name: node.expression.text, source: node.getText(authSourceFile) });
  });
  assert.deepEqual(membershipLoads.map(({ name }) => name), ["loadMembershipsForOrg", "loadMembershipsForOrg"]);
  assert.ok(membershipLoads.some(({ source }) => source.match(/effectivePersonId\s*,\s*token\.org_id/) !== null), "bearer memberships must stay org-filtered");
  assert.match(authSource, /effectivePersonId\s*=\s*createdBy/);
  assert.match(authSource, /effectivePersonId\s*=\s*actingPersonId/);
  assert.ok(membershipLoads.some(({ source }) => source.match(/person\.id\s*,\s*person\.org_id/) !== null), "cookie memberships must use the bearer org filter");

  const assignmentGuardCalls = allModules.flatMap((module) => {
    const sourceFile = ts.createSourceFile(module.path, module.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    return callSites(sourceFile, "reviewerCanBeAssignedToSubmission").map(({ line }) => ({ file: module.path, line }));
  });
  assert.deepEqual(assignmentGuardCalls.map(({ file }) => file).sort(), [
    "src/routes/evaluation.routes.ts",
    "src/routes/evaluation.routes.ts",
    "src/routes/public-form-routing.ts",
  ]);
  assert.ok(assignmentGuardCalls.every(({ line }) => line > 0));

  const assignmentInserts = allModules.flatMap((module) => {
    const lines = module.source.split("\n");
    return lines.flatMap((line, index) => line.match(/INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+round_assignments/i) !== null
      ? [{ file: module.path, line: index + 1 }]
      : []);
  });
  assert.deepEqual(assignmentInserts.map(({ file }) => file).sort(), [
    "src/routes/evaluation.routes.ts",
    "src/routes/evaluation.routes.ts",
    "src/routes/public-form-routing.ts",
  ]);

  const publicForm = parsedModules.find(({ module }) => module.path === "src/routes/public-form.routes.ts");
  assert.ok(publicForm);
  const assertRoutingCalls = callSites(publicForm.sourceFile, "assertRoutingPoolAllowed");
  const writeRoutingCalls = callSites(publicForm.sourceFile, "writeRoutingPoolAssignment");
  assert.equal(assertRoutingCalls.length, 1);
  assert.equal(writeRoutingCalls.length, 1);
  assert.ok(assertRoutingCalls[0].line < writeRoutingCalls[0].line, "routing writes must follow the no-human-in-loop guard");

  const evidenceInserts = allModules.flatMap((module) => {
    const lines = module.source.split("\n");
    return lines.flatMap((line, index) => {
      const table = /INSERT\s+INTO\s+(evaluations|comparisons)/i.exec(line)?.[1]?.toLowerCase();
      return table ? [{ file: module.path, line: index + 1, table }] : [];
    });
  });
  assert.deepEqual(evidenceInserts.map(({ table, file }) => [table, file]), [
    ["evaluations", "src/lib/sessionize-import.ts"],
    ["evaluations", "src/lib/sessionize-import.ts"],
    ["comparisons", "src/routes/review.routes.ts"],
    ["evaluations", "src/routes/review.routes.ts"],
  ]);

  const evaluationModule = parsedModules.find(({ module }) => module.path === "src/routes/evaluation.routes.ts");
  assert.ok(evaluationModule);
  const promotion = evaluationModule.routes.find(({ operationId }) => operationId === "promoteEvaluationSubmissions");
  assert.ok(promotion);
  assert.doesNotMatch(promotion.policy, /review:write/);
  assert.match(promotion.source, /round_promotions/);
  assert.match(promotion.source, /submission\.event_id\s*=\s*\?/);
});
