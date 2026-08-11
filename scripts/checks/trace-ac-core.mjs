import ts from "typescript-ast";

export const STRUCK_ACCEPTANCE_CRITERIA = new Set(["AC-239"]);

export function parseEvaluationContract(markdown) {
  const criteria = new Map();
  for (const line of markdown.split("\n")) {
    const match = line.match(/^\|\s*(AC-\d+)\s*\|(.+)$/);
    if (!match) continue;
    const id = match[1];
    if (STRUCK_ACCEPTANCE_CRITERIA.has(id)) continue;
    const cells = match[2].split("|").map((cell) => cell.replaceAll("`", "").trim());
    const tag = cells.find((cell) => ["auto", "op-assist", "oracle", "felt"].includes(cell));
    if (tag && !criteria.has(id)) criteria.set(id, { id, tag });
  }
  return criteria;
}

function callName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

export function scanTestSource(sourceText, filename) {
  const sourceFile = ts.createSourceFile(filename, sourceText, ts.ScriptTarget.Latest, true);
  const titles = [];
  const errors = [];

  function visit(node) {
    if (ts.isCallExpression(node) && ["test", "it"].includes(callName(node.expression))) {
      const titleNode = node.arguments[0];
      const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const reference = `${filename}:${location.line + 1}`;
      if (!titleNode || (!ts.isStringLiteral(titleNode) && !ts.isNoSubstitutionTemplateLiteral(titleNode))) {
        errors.push({ code: "dynamic-title", reference });
      } else {
        const title = titleNode.text;
        const prefix = title.match(/^((?:AC-\d+(?:\s*[,+]\s*AC-\d+)*)|CONTRACT)\s+·\s+/);
        if (!prefix) {
          errors.push({ code: "invalid-title-prefix", reference, title });
        } else {
          titles.push({
            reference,
            title,
            criteria: [...prefix[1].matchAll(/AC-\d+/g)].map((match) => match[0]),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { titles, errors };
}

export function buildCoverage({ criteria, scans, claims, scope }) {
  const errors = scans.flatMap((scan) => scan.errors);
  const coverage = new Map([...criteria.keys()].map((id) => [id, []]));
  for (const title of scans.flatMap((scan) => scan.titles)) {
    for (const id of title.criteria) {
      if (STRUCK_ACCEPTANCE_CRITERIA.has(id)) {
        errors.push({ code: "struck-criterion", id, reference: title.reference });
      } else if (!criteria.has(id)) {
        errors.push({ code: "unknown-criterion", id, reference: title.reference });
      } else {
        coverage.get(id).push(title.reference);
      }
    }
  }

  const owners = new Map();
  for (const claim of claims) {
    for (const id of claim.owns ?? []) {
      if (!criteria.has(id)) errors.push({ code: "claim-unknown-criterion", id, ticket: claim.ticket });
      if (owners.has(id)) errors.push({ code: "duplicate-owner", id, tickets: [owners.get(id), claim.ticket] });
      owners.set(id, claim.ticket);
    }
    for (const id of claim.exercises ?? []) {
      if (!criteria.has(id)) errors.push({ code: "exercise-unknown-criterion", id, ticket: claim.ticket });
    }
  }

  const enforcedIds = scope === "all" ? [...criteria.keys()] : [...owners.keys()];
  const uncovered = enforcedIds.filter(
    (id) => criteria.get(id)?.tag === "auto" && coverage.get(id)?.length === 0,
  );
  const uncoveredPendingOperator = enforcedIds
    .filter((id) => criteria.get(id)?.tag !== "auto" && coverage.get(id)?.length === 0)
    .map((id) => ({ id, tag: criteria.get(id)?.tag }));
  return {
    errors,
    uncovered,
    uncoveredPendingOperator,
    coverage: Object.fromEntries(
      [...criteria].map(([id, criterion]) => [id, { ...criterion, tests: coverage.get(id) }]),
    ),
  };
}
