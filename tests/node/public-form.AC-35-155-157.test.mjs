import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

test("AC-35 + AC-36 + AC-155 + AC-156 + AC-157 · the public form has a 375px field and resume contract", async () => {
  const styles = await readFile(resolve(ROOT, "src/ui/public/form/styles.ts"), "utf8");
  const component = await readFile(resolve(ROOT, "src/ui/public/form/PublicForm.tsx"), "utf8");
  const routes = await readFile(resolve(ROOT, "src/routes/public-form.routes.ts"), "utf8");
  assert.match(styles, /@media \(max-width: 560px\)/);
  assert.match(styles, /width: calc\(100% - 24px\)/);
  assert.match(styles, /overflow-wrap: anywhere/);
  assert.match(styles, /box-sizing: border-box/);
  assert.match(styles, /min-height: 3\.6em/);
  assert.match(styles, /visibility: hidden/);
  assert.match(styles, /overflow-x: clip/);
  assert.match(component, /scrollIntoView/);
  assert.match(component, /focusFirstInvalidField/);
  assert.ok((component.match(/focusFirstInvalidField/g) ?? []).length >= 3, "client validation and 422 handling must focus through the same first-field helper");
  assert.match(component, /visibleFields\.find\(\(field\) => keys\.includes\(field\.key\)\)/);
  assert.match(component, /pageErrorRef/);
  assert.match(component, /tabIndex=\{-1\}/);
  assert.match(component, /focus\(\{ preventScroll: true \}\)/);
  assert.match(component, /visualViewport/);
  assert.match(component, /getBoundingClientRect/);
  assert.match(component, /scrollWidth > root\.clientWidth/);
  assert.match(component, /data-field-type=\{field\.type\}/);
  assert.match(component, /state\.resume_token/);
  assert.match(component, /Save draft/);
  assert.match(component, /draftEmailPrompt/);
  assert.match(component, /Contact address for your resume link/);
  assert.match(component, /Copy resume link/);
  assert.match(component, /navigator\.clipboard/);
  assert.doesNotMatch(component, /Draft saved locally/);
  // The limit sentence still sits above the first add-person control (AC-29),
  // but it no longer calls the remaining places "co-speaker slots": a slot now
  // takes a moderator too, and copy that names one role while the control
  // offers two is copy that lies about the control beneath it (MRQ-224).
  assert.match(component, /room for one more person/);
  assert.match(component, /public-participant-limit/);
  assert.match(styles, /\.public-save-status \{[^}]*min-width: 15ch/);
  assert.match(styles, /\.public-form-actions/);
  // The confirmation's resume link stays on the origin the submitter is looking
  // at; an absolute href sends a local validation run to the deployed host.
  assert.match(component, /href=\{resumeLinkPath\(state\.resume_url\)\}/);
  assert.doesNotMatch(component, /href=\{state\.resume_url\}/);
  assert.match(component, /PATCH/);
  assert.match(component, /Submit abstract/);
  for (const type of ["short_text", "long_text", "single_select", "multi_select", "url", "email", "file", "number", "date"]) {
    assert.match(routes, new RegExp(`\\"${type}\\"`));
  }
});
