/**
 * Policy for source-text assertions in tests.
 *
 * Reading a production file as text is not automatically a no-op. A test that
 * pins a sentence of user-facing copy is testing that sentence; the sentence
 * is the artifact. A test that pins a class, selector, route, call site, or
 * identifier is different: the token can survive while the behavior it names
 * disappears. This policy reports only that unambiguous structural subset.
 */

const READ_CALL = /\b(?:readFileSync|readFile)\s*\(/;
const TEST_FILE = /\.(?:test|spec)\.(?:mjs|js|ts|tsx)$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** The existing population is a backlog, not a permanent waiver. */
export const KNOWN_OFFENDERS = Object.freeze({
  // Existing findings remain visible backlog; new files hard-fail the gate.
  "tests/node/agenda-publish.AIA-07.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/agenda-transit.AC-258-259.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/api-tokens-ui.AC-106.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/audit-request-id.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/auth-boundary.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/bulk-paths.AC-66-69.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/comms-ui.AC-128-131-250.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/comms.AC-250.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/decided-not-notified.AC-268-269.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/delivery-health.MRQ-102.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/demo-mail-allowlist-ui.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/empty-state.AC-161.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/event-settings-ui.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/file-comments-ui.MRQ-116.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/files-export-ui.MRQ-117.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/forms-layout.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/kind-legibility.MRQ-206.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/latent-space-theme.MRQ-158.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/live-record-cue.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/mrq-66-migration.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/mrq-93-portal-task-subjects.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/not-found-config.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/portal-arrival-map.MRQ-91.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/portal-invite-import.MRQ-113.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/public-form.AC-35-155-157.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/quick-search.AC-101-104.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/r2-cors.MRQ-92.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/reset-demo-ui.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/reset-wipe-order.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/reviewer-boundary.AC-214-246.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/shell-truth.MRQ-125.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/speaker-directory-search.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/speaker-files-ui.MRQ-176.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/submission-board.AC-243.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/submission-reversal.AC-123.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/submissions-sort-fallback.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/task-authoring-ui.MRQ-114.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/task-cancellation.AC-264-267.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/task-session-link-ui.MRQ-140.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/task-templates-ui.MRQ-96.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/venue-disclosure.AC-263.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/venue-ui-contract.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/node/views-ui.AC-134-248.test.mjs": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/unit/agenda-click-to-place.MRQ-141.test.ts": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/unit/cold-start-screens.AC-280.test.ts": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/unit/content-history-panel.MRQ-118.test.ts": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/unit/criterion-options-width.eval11.test.ts": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/unit/delete-conference.MRQ-204.test.ts": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/unit/evaluation-panel-labels.eval11.test.ts": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/unit/import-unmatched-taxonomy.MRQ-84.test.ts": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/unit/outreach.MRQ-205.test.ts": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/unit/people.MRQ-131.test.ts": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/unit/portal-preview-open.eval11.test.ts": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/unit/public-embed-fields-layout.test.ts": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/unit/publication-review-legibility.MRQ-135.test.ts": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/unit/reviewer-surface.AC-61-158-159.test.ts": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/unit/submission-record-overflow.test.ts": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/unit/submission-record-panel-scorecard.eval11.test.ts": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
  "tests/unit/theme.MRQ-103.test.ts": { ticket: "MRQ-192", reason: "existing structural source-text assertion; migrate to runtime or rendered proof" },
});

function stripLineComment(line) {
  let quote = "";
  for (let index = 0; index < line.length - 1; index += 1) {
    const character = line[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "\x60") {
      quote = character;
      continue;
    }
    if (character === "/" && line[index + 1] === "/") return line.slice(0, index);
  }
  return line;
}

function hasSourcePath(text) {
  return /["'](?:\.\.?\/)*src(?:\/|["',])/.test(text);
}

function addBinding(bindings, name) {
  if (!name) return;
  const clean = name.trim().replace(/\s*=.*$/, "").trim();
  if (IDENTIFIER.test(clean)) bindings.add(clean);
}

function addDestructuredBindings(bindings, declaration) {
  const match = /\b(?:const|let|var)\s*\[([^\]]+)\]\s*=/.exec(declaration);
  if (!match) return;
  for (const entry of match[1].split(",")) addBinding(bindings, entry.split("=")[0]);
}

/**
 * Find values assigned from a direct source-file read. The detector
 * intentionally does not chase arbitrary helper functions or data flow:
 * precision is more valuable than a noisy approximation for this gate.
 */
function sourceBindings(source) {
  const bindings = new Set();
  const pathBindings = new Set();
  const lines = source.split("\n");

  for (const line of lines) {
    const code = stripLineComment(line);
    if (!hasSourcePath(code)) continue;
    const pathDeclaration = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(code);
    if (pathDeclaration && !READ_CALL.test(code)) pathBindings.add(pathDeclaration[1]);
  }

  for (const line of lines) {
    const code = stripLineComment(line);
    if (!READ_CALL.test(code)) continue;
    const readsSrc = hasSourcePath(code) || [...pathBindings].some((name) => (
      new RegExp("\\b" + name + "\\b").test(code)
    ));
    if (!readsSrc) continue;

    const assignment = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(code);
    addBinding(bindings, assignment?.[1]);
    const property = /\b([A-Za-z_$][\w$]*)\s*:\s*(?:await\s+)?(?:[\w$.]+\.)?(?:readFileSync|readFile)\s*\(/.exec(code);
    addBinding(bindings, property?.[1]);
    addDestructuredBindings(bindings, code);
  }

  return bindings;
}

function firstRegexBody(text) {
  const match = /\/((?:\\.|[^/\\])*)\/[dgimsuvy]*/.exec(text);
  return match?.[1] ?? null;
}

function stringBodies(text) {
  const bodies = [];
  const expression = /(["'])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let match;
  while ((match = expression.exec(text)) !== null) bodies.push(match[2]);
  return bodies;
}

function unescapeRegexBody(body) {
  return body
    .replace(/\\s\*?\+?/g, " ")
    .replace(/\\[.]/g, ".")
    .replace(/\\([\\/])/g, "$1")
    .replace(/\\([{}()[\]?$^|])/g, "$1");
}

function looksLikeCopy(body) {
  const readable = unescapeRegexBody(body)
    .replace(/<\/?[A-Za-z][A-Za-z0-9]*>/g, "")
    .replace(/&(?:amp|apos|quot|lt|gt|#\d+);/g, " ")
    .trim();
  if (!readable) return false;
  if (/[(){}[\]<>_=/.#$|]/.test(readable)) return false;
  if (/[A-Za-z_$][\w$]*\s*=>/.test(readable)) return false;
  if (/\b(?:class|className|aria|data|href|role|type|method|style|on[A-Z]|api|route|path|state|request|fetch|navigate)\b/.test(readable)) return false;
  if (/[A-Za-z][A-Z][A-Za-z]/.test(readable)) return false;
  if (/\b[A-Za-z_$][\w$]*_[A-Za-z_$][\w$]*\b/.test(readable)) return false;
  if (/^[A-Za-z_$][\w$]*-[A-Za-z_$][\w$]*$/.test(readable)) return false;
  const words = readable.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && /^[\p{L}\p{N}\s'’.,!?;:&\-–—…]+$/u.test(readable)) return true;
  return words.length === 1 && /^[A-Z][a-z]+:?$/.test(readable);
}

/**
 * Return true for a matcher whose spelling is an implementation token rather
 * than an exact copy sentence. The default is intentionally conservative:
 * ambiguous one-word strings are left alone to avoid teaching authors to
 * suppress a noisy check.
 */
export function isStructuralMatcher(text) {
  const regexBody = firstRegexBody(text);
  if (regexBody !== null) {
    const readable = unescapeRegexBody(regexBody);
    if (looksLikeCopy(regexBody)) return false;
    if (/\b(?:class|className|aria|data|href|role|type|method|style|on[A-Z]|api|route|path|state|request|fetch|navigate)\b/.test(readable)) return true;
    if (/[(){}[\]<>_=/:.#$|]/.test(readable)) return true;
    if (/[A-Za-z_$][\w$]*[A-Z][\w$]*|\b[A-Z][A-Z0-9_]+\b/.test(readable)) return true;
    if (/\b[A-Za-z_$][\w$]*-[A-Za-z_$][\w$]*\b/.test(readable) && !/\s/.test(readable)) return true;
    return false;
  }

  const strings = stringBodies(text);
  if (strings.length > 0) return strings.some((body) => !looksLikeCopy(body));

  // Dynamic needles are not copy literals. A source assertion using one is
  // structural by construction.
  return /\b(?:toMatch|toContain|includes|indexOf|\.test|\.exec)\s*\(/.test(text)
    || /\b(?:toMatch|toContain)\s*\([^)]*[A-Za-z_$][\w$]*\.[A-Za-z_$]/.test(text);
}

function containsBinding(code, bindings) {
  return [...bindings].some((binding) => new RegExp(
    "(?:^|[^A-Za-z0-9_$])" + binding + "(?:$|[^A-Za-z0-9_$])",
  ).test(code));
}

function isSourceAssertion(code, bindings) {
  if (!containsBinding(code, bindings)) return false;
  return /\bassert\.(?:match|doesNotMatch|ok|equal|strictEqual|deepEqual)\s*\(/.test(code)
    || /\bexpect\s*\(/.test(code)
    || /\.(?:toMatch|toContain|includes|indexOf|match|test|exec)\s*\(/.test(code);
}

function shortExpression(code) {
  return code.trim().replace(/\s+/g, " ").slice(0, 240);
}

/** Return structural source-text assertions in one test file. */
export function sourceTextFindings(relative, source) {
  if (!TEST_FILE.test(relative)) return [];
  const bindings = sourceBindings(source);
  if (bindings.size === 0) return [];

  const findings = [];
  for (const [index, rawLine] of source.split("\n").entries()) {
    const code = stripLineComment(rawLine);
    if (!isSourceAssertion(code, bindings)) continue;
    if (!isStructuralMatcher(code)) continue;
    findings.push({
      rule: "source-text-behavior-assertion",
      file: relative,
      line: index + 1,
      detail: "matches an implementation token against source text; the token can survive while the behavior it names is gone",
      fix: "assert the rendered/runtime property, or keep only an exact user-facing copy assertion",
      expression: shortExpression(code),
    });
  }
  return findings;
}

export function uniqueOffenderFiles(findings) {
  return [...new Set(findings.map((finding) => finding.file))].sort();
}

export function classifyFindings(findings, baseline = KNOWN_OFFENDERS) {
  return findings.map((finding) => ({
    ...finding,
    known: Object.prototype.hasOwnProperty.call(baseline, finding.file),
  }));
}

export function gateStatus(findings, baseline = KNOWN_OFFENDERS) {
  const classified = classifyFindings(findings, baseline);
  const files = uniqueOffenderFiles(findings);
  const knownFiles = files.filter((file) => Object.prototype.hasOwnProperty.call(baseline, file));
  const newFiles = files.filter((file) => !knownFiles.includes(file));
  const staleAllowlist = Object.keys(baseline).filter((file) => !files.includes(file));
  const status = newFiles.length > 0 || staleAllowlist.length > 0 ? "fail" : "pass";
  return { classified, files, knownFiles, newFiles, staleAllowlist, status };
}
