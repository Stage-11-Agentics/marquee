/**
 * Two controls that a grading agent could not find, guarded at the source.
 *
 * Both defects here are the same shape: the product could do the thing, and the
 * page gave the reader no way to know it. There is no browser harness in this
 * repo (`npm run e2e` is a registered stub), so these are source contracts —
 * they cannot prove the pixels, and the PR carries the live evidence for that.
 * What they can do is stop the exact regressions from reappearing silently,
 * which is what a conditional render did the first time.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const read = (path) => readFile(resolve(root, path), "utf8");

test("CONTRACT · ABS-09 · Remind renders for every reviewer, disabled rather than absent when nothing is outstanding", async () => {
  const source = await read("src/ui/evaluation/EvaluationPage.tsx");

  // The regression: `progress?.outstanding_count ? <Button…>Remind</Button> : …`
  // rendered the control only while work was outstanding, so a fully-reviewed
  // conference showed no reviewer-nudge affordance anywhere on the page.
  const remindIndex = source.indexOf(">Remind<");
  assert.notEqual(remindIndex, -1, "the Remind control no longer exists in EvaluationPage");

  const declaration = source.slice(source.lastIndexOf("const action =", remindIndex), remindIndex);
  assert.ok(
    !/outstanding_count\s*$/.test(declaration.trim()) && !/outstanding_count\s*\n?\s*\?/.test(declaration),
    "Remind is gated on outstanding_count again — it must render always and disable instead",
  );
  assert.match(
    declaration,
    /disabled=\{outstanding === 0\}/,
    "Remind must carry an explicit disabled state for the caught-up case",
  );
  // A disabled control with no explanation is only marginally better than a
  // missing one: the reader still cannot tell unavailable from broken.
  assert.match(declaration, /title=\{/, "the disabled Remind must say why it is disabled");

  // The row's action column is a fixed track, so neither state resizes it.
  const css = await read("src/ui/evaluation/evaluation.css");
  assert.match(
    css,
    /\.committee-person\s*\{[^}]*grid-template-columns:\s*28px minmax\(0, 1fr\) 104px/,
    "the committee row's action column must stay a fixed width across both states",
  );
  assert.match(
    css,
    /\.committee-person-action \.button:disabled\b/,
    "the disabled Remind needs its own visible treatment; the global .45 ghost opacity is near-invisible",
  );
});

test("CONTRACT · ABS-13 · every CSV export on the submissions register reports what it delivered", async () => {
  const source = await read("src/ui/submissions/SubmissionsPage.tsx");

  // "Export scores (CSV)" was a bare `<a download>`: the file landed and the
  // page said nothing, so nobody watching the screen could tell it had worked.
  const anchor = source.slice(source.indexOf("Export scores (CSV)") - 600, source.indexOf("Export scores (CSV)"));
  assert.match(anchor, /onClick=\{\(event\) => void exportScores\(event\)\}/, "the scores export must announce itself");
  assert.match(anchor, /download="review-results\.csv"/, "the anchor keeps its native download for modified clicks");

  // Both exports name the file and the row count in the reserved status line.
  for (const filename of ["marquee-submissions.csv", "${filename}"]) {
    assert.ok(
      source.includes(`setExportNotice(\`Exported \${`) && source.includes(filename),
      `an export on this page does not report ${filename}`,
    );
  }
  // The export result shares the table's one reserved status strip with saved
  // views, bulk decisions and the background refresh — a row apiece was two
  // dead bands between the filters and the first record. Reserved is still the
  // rule: the strip holds a fixed height, so a message arriving never moves the
  // table under the operator's cursor.
  assert.match(source, /const statusError = exportError\b/, "an export failure must reach the shared status strip");
  assert.match(source, /const statusNotice = exportNotice\b/, "an export result must reach the shared status strip");
  assert.match(source, /class=\{`table-status-bar /, "the strip is the one surface those values render into");
  assert.match(
    await read("src/ui/submissions/submissions.css"),
    /\.table-status-bar \{[^}]*min-height: \d+px/,
    "the status strip must keep its reserved space so the row never jumps",
  );

  // Modified clicks still belong to the browser, not to us.
  const handler = source.slice(source.indexOf("const exportScores"), source.indexOf("const exportScores") + 500);
  assert.match(handler, /event\.button !== 0 \|\| event\.metaKey/, "modified clicks must fall through to the anchor");
});
