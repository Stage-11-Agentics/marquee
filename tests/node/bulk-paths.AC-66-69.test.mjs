import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript-ast";

const root = resolve(import.meta.dirname, "../..");

async function loadModules() {
  const paths = (await readdir(resolve(root, "src"), { recursive: true }))
    .filter((path) => path.match(/\.(?:ts|tsx)$/) !== null)
    .sort();
  return Promise.all(paths.map(async (path) => ({
    path: `src/${path}`,
    absolute: resolve(root, "src", path),
    source: await readFile(resolve(root, "src", path), "utf8"),
  })));
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function namedScope(module, name) {
  const sourceFile = ts.createSourceFile(
    module.absolute,
    module.source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let match = null;
  walk(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) match = node;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) match = node;
  });
  return match ? match.getText(sourceFile) : null;
}

function callsNamed(module, name) {
  const sourceFile = ts.createSourceFile(
    module.absolute,
    module.source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let count = 0;
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;
    if (ts.isIdentifier(node.expression) && node.expression.text === name) count += 1;
    if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === name) count += 1;
  });
  return count;
}

function moduleByPath(modules, path) {
  const module = modules.find((candidate) => candidate.path === path);
  assert.ok(module, `missing source module ${path}`);
  return module;
}

function ownerName(node) {
  let current = node.parent;
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name?.text) return current.name.text;
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      let parent = current.parent;
      while (parent) {
        if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
        parent = parent.parent;
      }
    }
    current = current.parent;
  }
  return "<module>";
}

function siteIdentity(site) {
  return JSON.stringify([site.file, site.owner, site.binding, site.expression]);
}

function sortSites(sites) {
  return sites.slice().sort((left, right) => siteIdentity(left).localeCompare(siteIdentity(right)));
}

function bindingName(node) {
  let current = node.parent;
  while (current) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text;
    current = current.parent;
  }
  return null;
}

function isQuestionMarkLiteral(node) {
  return ts.isStringLiteralLike(node) && node.text === "?";
}

function returnsQuestionMark(callback) {
  if (ts.isArrowFunction(callback) && !ts.isBlock(callback.body)) {
    return isQuestionMarkLiteral(callback.body);
  }
  let found = false;
  walk(callback.body, (node) => {
    if (ts.isReturnStatement(node) && node.expression && isQuestionMarkLiteral(node.expression)) {
      found = true;
    }
  });
  return found;
}

function placeholderSites(modules) {
  return modules.flatMap((module) => {
    const sourceFile = ts.createSourceFile(
      module.absolute,
      module.source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const sites = [];
    walk(sourceFile, (node) => {
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== "map") return;
      const callback = node.arguments[0];
      if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) || !returnsQuestionMark(callback)) return;
      const declaration = node.parent && ts.isVariableDeclaration(node.parent) && node.parent.initializer === node
        ? node.parent
        : null;
      sites.push({
        file: module.path,
        owner: ownerName(node),
        binding: declaration && ts.isIdentifier(declaration.name) ? declaration.name.text : bindingName(node),
        expression: node.getText(sourceFile).replace(/\s+/g, " "),
      });
    });
    return sites;
  }).sort((left, right) => siteIdentity(left).localeCompare(siteIdentity(right)));
}

function nonMapPlaceholderSites(modules) {
  return sortSites(modules.flatMap((module) => {
    const sourceFile = ts.createSourceFile(
      module.absolute,
      module.source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const sites = [];
    walk(sourceFile, (node) => {
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
      const method = node.expression.name.text;
      const receiver = node.expression.expression;
      const fillText = method === "fill" && isQuestionMarkLiteral(node.arguments[0]) ? node.arguments[0].text : null;
      const repeatText = method === "repeat" && ts.isStringLiteralLike(receiver) && /\?/.exec(receiver.text) !== null
        ? receiver.text
        : null;
      if (fillText === null && repeatText === null) return;
      sites.push({
        file: module.path,
        owner: ownerName(node),
        binding: bindingName(node),
        expression: node.getText(sourceFile).replace(/\s+/g, " "),
        classification: "UNCLASSIFIED",
      });
    });
    return sites;
  }));
}

const EXPECTED_PLACEHOLDER_SITES = [
  {
    file: "src/lib/files/versions.ts",
    owner: "readAttachments",
    binding: "result",
    expression: 'chunk.map(() => "?")',
    classification: "outside named bulk families; version-history read in explicit 80-owner chunks, plus one owner_type binding, stays below D1's binding cap",
  },
  {
    file: "src/lib/files/versions.ts",
    owner: "readPointers",
    binding: "rows",
    expression: 'chunk.map(() => "?")',
    classification: "outside named bulk families; latest-pointer read in explicit 80-owner chunks stays below D1's binding cap",
  },
  {
    file: "src/lib/reset-demo/demo-fixture.ts",
    owner: "shippedDemoFixtureRows",
    binding: null,
    expression: 'columns.map(() => "?")',
    classification: "one placeholder per COLUMN of a single-row INSERT; bounded by the table schema, not by any caller-supplied list, so it cannot approach D1's binding cap",
  },
  {
    file: "src/lib/reviewer-scope.ts",
    owner: "authorizeReviewerQueueScope",
    binding: "result",
    expression: 'chunk.map(() => "?")',
    classification: "outside named bulk writes; explicit 80-ID authorization chunks stay below D1's binding cap",
  },
  {
    file: "src/lib/venues.ts",
    owner: "assertIdsBelongToEvent",
    binding: "placeholders",
    expression: 'ids.map(() => "?")',
    classification: "outside named bulk families; model-validation read; no explicit model-ID max",
  },
  {
    file: "src/routes/agenda.queries.ts",
    owner: "readPool",
    binding: "placeholders",
    expression: 'statuses.map(() => "?")',
    classification: "bounded by the seven-value SCHEDULABLE_STATUS_OPTIONS taxonomy",
  },
  {
    file: "src/routes/evaluation.routes.ts",
    owner: "replaceReviewerScopes",
    binding: "placeholders",
    expression: 'trackIds.map(() => "?")',
    classification: "outside the named assignment-distribution path; reviewer-scope read; no explicit track-ID max",
  },
  {
    file: "src/routes/evaluation.routes.ts",
    owner: "distributeAssignments",
    binding: "submissions",
    expression: 'body.submission_ids.map(() => "?")',
    classification: "NAMED_FINDING: assignment selection expands one D1 placeholder per submission; no selector max",
  },
  {
    file: "src/routes/public-form-routing.ts",
    owner: "selectSubmissionRouting",
    binding: "tracks",
    expression: 'input.trackIds.map(() => "?")',
    classification: "NAMED_FINDING: category routing expands one D1 placeholder per track; no input max",
  },
  {
    file: "src/routes/public-form.routes.ts",
    owner: "moveAttachments",
    binding: "placeholders",
    expression: 'attachmentIds.map(() => "?")',
    classification: "outside named bulk families; draft attachment ownership read/update; answer-derived IDs",
  },
  {
    file: "src/routes/public-form.routes.ts",
    owner: "handlePublicSubmission",
    binding: "admins",
    expression: 'adminIds.map(() => "?")',
    classification: "bounded at form create/update by forms.routes.ts admin_notify_person_ids.max(100); import writes '[]'",
  },
  {
    file: "src/routes/review.routes.ts",
    owner: "queueRows",
    binding: "result",
    expression: 'chunk.map(() => "?")',
    classification: "outside named bulk writes; explicit 80-ID queue-read chunks stay below D1's binding cap",
  },
  {
    file: "src/routes/review.routes.ts",
    owner: "reviewsForSubmissions",
    binding: "result",
    expression: 'chunk.map(() => "?")',
    classification: "outside named bulk writes; reads one reviewer's stored reviews in the same explicit 80-ID chunks as queueRows, over a completed set the queue caps at 50",
  },
  {
    file: "src/routes/submission-record.routes.ts",
    owner: "validateOwnedIds",
    binding: "result",
    expression: 'trackIds.map(() => "?")',
    classification: "bounded by the track_ids/tracks.max(20) submission-record schema",
  },
  {
    file: "src/routes/submissions.queries.ts",
    owner: "addDraftMetadata",
    binding: "formPlaceholders",
    expression: 'formIds.map(() => "?")',
    classification: "outside named bulk families; unbounded form IDs are read before draft pagination; routed observation",
  },
  {
    file: "src/routes/submissions.queries.ts",
    owner: "addDraftMetadata",
    binding: "submissionPlaceholders",
    expression: 'submissionIds.map(() => "?")',
    classification: "outside named bulk families; unbounded rows are enriched before pagination; candidate D1-cap read; routed observation",
  },
  {
    file: "src/routes/tokens.routes.ts",
    owner: "assertEventIdsBelongToOrg",
    binding: "placeholders",
    expression: 'eventIds.map(() => "?")',
    classification: "outside named bulk families; event_ids.max(100) plus org binding can reach 101 D1 bindings; routed observation",
  },
];

test("CONTRACT · every named bulk family has one classified write seam", async () => {
  const modules = await loadModules();
  const decisionModule = moduleByPath(modules, "src/jobs/cascade/decisions.ts");
  const decisionRoute = moduleByPath(modules, "src/routes/submissions-bulk.routes.ts");
  const commsModule = moduleByPath(modules, "src/routes/comms.routes.ts");
  const evaluationModule = moduleByPath(modules, "src/routes/evaluation.routes.ts");
  const routingModule = moduleByPath(modules, "src/routes/public-form-routing.ts");
  const importModule = moduleByPath(modules, "src/lib/sessionize-import.ts");
  const bulkModule = moduleByPath(modules, "src/api/bulk.ts");

  const scopes = {
    bulkDecideSubmissions: namedScope(decisionRoute, "bulkDecideSubmissions"),
    writeBulkSubmissionDecisions: namedScope(decisionModule, "writeBulkSubmissionDecisions"),
    sendCommunication: namedScope(commsModule, "sendComms"),
    recipientsFor: namedScope(commsModule, "recipientsFor"),
    distributeEvaluationAssignments: namedScope(evaluationModule, "distributeAssignments"),
    promoteEvaluationSubmissions: namedScope(evaluationModule, "promoteRound"),
    selectSubmissionRouting: namedScope(routingModule, "selectSubmissionRouting"),
    runSessionizeImport: namedScope(importModule, "runSessionizeImport"),
  };
  for (const [operation, source] of Object.entries(scopes)) {
    assert.ok(source, `bulk inventory lost operation ${operation}`);
  }

  // Positive controls: this test cannot pass with an empty or dead inventory.
  assert.match(scopes.bulkDecideSubmissions, /writeBulkSubmissionDecisions/);
  assert.match(decisionRoute.source, /z\.enum\(\["accept", "reject", "waitlist", "withdraw"\]\)/);
  assert.match(scopes.writeBulkSubmissionDecisions, /updateSubmissionStatus/);
  assert.match(scopes.writeBulkSubmissionDecisions, /insertDecisions/);
  assert.match(scopes.writeBulkSubmissionDecisions, /bulk_submission_decision/);
  assert.match(scopes.writeBulkSubmissionDecisions, /operationId/);
  assert.match(scopes.sendCommunication, /recipientsFor/);
  assert.match(scopes.sendCommunication, /enqueueBulkReminder/);
  assert.match(scopes.recipientsFor, /json_each\(\?\)/);
  assert.match(scopes.recipientsFor, /return \[\]/);
  assert.match(scopes.distributeEvaluationAssignments, /const statements = pairs\.map/);
  assert.match(scopes.distributeEvaluationAssignments, /INSERT OR IGNORE INTO round_assignments/);
  assert.match(scopes.promoteEvaluationSubmissions, /runBulkByIds/);
  assert.match(scopes.selectSubmissionRouting, /SELECT id, name FROM tracks/);
  assert.match(routingModule.source, /writeRoutingPoolAssignment/);
  assert.match(scopes.runSessionizeImport, /importSpeaker/);
  assert.match(scopes.runSessionizeImport, /importSession/);

  // Inventory every map callback that emits a SQL placeholder across src,
  // including hoisted bindings and inline template expressions. The
  // classifications are deliberate: a new site, changed idiom, or quiet
  // removal fails this guard and forces a fresh scale audit.
  const observedPlaceholderSites = placeholderSites(modules).map((site) => ({
    ...site,
    classification: EXPECTED_PLACEHOLDER_SITES.find((expected) =>
      expected.file === site.file
      && expected.owner === site.owner
      && expected.binding === site.binding
      && expected.expression === site.expression
    )?.classification ?? "UNCLASSIFIED",
  }));
  const expectedPlaceholderSites = EXPECTED_PLACEHOLDER_SITES
    .slice()
    .sort((left, right) => siteIdentity(left).localeCompare(siteIdentity(right)));
  const expectedSiteKeys = expectedPlaceholderSites.map((site) => siteIdentity(site));
  assert.equal(
    new Set(expectedSiteKeys).size,
    expectedSiteKeys.length,
    "repo-wide D1 placeholder inventory has duplicate identity keys; disambiguate before changing this allowlist",
  );
  assert.deepEqual(
    observedPlaceholderSites,
    expectedPlaceholderSites,
    "repo-wide D1 placeholder inventory changed; classify and re-audit the new site before changing this allowlist",
  );
  assert.deepEqual(
    nonMapPlaceholderSites(modules),
    [],
    "a non-map D1 placeholder expansion appeared; classify and re-audit the new site before changing this allowlist",
  );

  const namedFindings = observedPlaceholderSites
    .filter((site) => site.classification.startsWith("NAMED_FINDING:"))
    .map(({ file, owner, binding, expression, classification }) => ({ file, owner, binding, expression, classification }));
  assert.deepEqual(
    namedFindings,
    expectedPlaceholderSites.filter((site) => site.classification.startsWith("NAMED_FINDING:")),
    "named bulk D1-cap findings changed; route the new path and re-audit before changing this allowlist",
  );

  // The assignment route has a second scale hazard: its public schema does
  // not cap the exact-ID list at the shared 1,000-ID contract. Keep both
  // properties visible in the future-proof inventory.
  assert.match(
    evaluationModule.source,
    /submission_ids:\s*z\.array\(z\.string\(\)\.min\(1\)\)\.min\(1\)\.optional\(\)/,
    "assignment distribution selector bound changed; re-audit its scale contract",
  );

  assert.equal(callsNamed(bulkModule, "runBulkByIds"), 0, "the helper definition must not recursively call itself");
  const helperCalls = modules.flatMap((module) => Array.from({ length: callsNamed(module, "runBulkByIds") }, () => module.path));
  assert.deepEqual(
    helperCalls.sort(),
    ["src/jobs/cascade/decisions.ts", "src/routes/evaluation.routes.ts"],
    "runBulkByIds call-site inventory changed; re-audit helper callers before changing this allowlist",
  );
  assert.equal((bulkModule.source.match(/export async function runBulkByIds/g) ?? []).length, 1);
  assert.match(bulkModule.source, /if \(normalized\.length === 0\) return null/);
  assert.match(bulkModule.source, /return prepare\(idsJson\)\.run/);
});
