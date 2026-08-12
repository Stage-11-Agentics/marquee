/**
 * Four dead ends an outside evaluator walked into on the deployed build. Each
 * one left a person holding a screen that told them nothing they could act on,
 * so each assertion here is about what the surface SAYS, not about plumbing.
 */
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path) => readFile(resolve(ROOT, path), "utf8");

test("CONTRACT · the public form repeats the server's own reason instead of house copy", async () => {
  const component = await read("src/ui/public/form/PublicForm.tsx");
  // A 409 is where the server writes the only actionable sentence in the
  // response ("Your abstract limit is full. Use a saved resume link…").
  assert.match(component, /error\.status === 409 \|\| error\.status === 422/);
  assert.match(component, /const served = error\.message\.trim\(\)/);
  // The retired copy pointed at "the message above", which was never there.
  assert.doesNotMatch(component, /after following the message above/);
});

test("CONTRACT · a file that fails to attach says so on the field the person just used", async () => {
  const component = await read("src/ui/public/form/PublicForm.tsx");
  assert.match(component, /function setFileError/);
  // Every exit from handleFile that does not attach has to explain itself; the
  // silent `return` left a filename and a crop preview above the words "No file
  // attached yet." with nothing anywhere saying why.
  const handleFile = component.slice(component.indexOf("async function handleFile"), component.indexOf("async function submit"));
  assert.match(handleFile, /setFileError\(field, answerEmail\(answers\)/);
  assert.match(handleFile, /Add your contact address at the bottom of this form first/);
  assert.doesNotMatch(handleFile, /draft_id\) return;\n\s*setBusy/);
  // The catch has to mark the field too, not only the page banner.
  assert.equal((handleFile.match(/setFileError\(/g) ?? []).length, 3);
});

test("CONTRACT · Save draft names the missing contact address where the person is looking", async () => {
  const component = await read("src/ui/public/form/PublicForm.tsx");
  const ensureDraft = component.slice(component.indexOf("async function ensureDraft"), component.indexOf("async function saveDraft"));
  assert.match(ensureDraft, /setDraftEmailPrompt\(true\)/);
  // Revealing and focusing a footer field on a nineteen-field form is not a
  // message: the reveal happens off-screen.
  assert.match(ensureDraft, /setPageError\("Add a contact address at the bottom of this form/);
  assert.doesNotMatch(ensureDraft, /setDraftEmailPrompt\(true\);\n\s*setPageError\(null\)/);
});

test("CONTRACT · /site reaches the conference site rather than the shell's Route not found", async () => {
  const route = await read("src/routes/public-agenda.route.tsx");
  assert.match(route, /publicAgendaRoutes\.get\("\/site"/);
  assert.match(route, /context\.redirect\(`\/agenda\$\{url\.search\}`, 302\)/);
  // The app shell's router has no /site, so an unhandled /site falls through to
  // the asset shell and renders a dead end on a page that is live at /agenda.
  const routeTable = await read("src/ui/shell/route-table.ts");
  assert.doesNotMatch(routeTable, /path: "\/site"/);
});

test("CONTRACT · the reviewer queue names the reviewer it belongs to", async () => {
  const page = await read("src/ui/review/ReviewerPage.tsx");
  assert.match(page, /import \{ useIdentity \} from "\.\.\/shell\/identity"/);
  assert.match(page, /const identity = useIdentity\(\)/);
  assert.match(page, /Reviewing as \$\{identity\.name\}/);
  // Anonymity in this round hides the speaker from the reviewer. It has never
  // meant hiding the reviewer from themselves — every review recorded here is
  // attributed by name on the organizer's record.
  assert.match(page, /blindMode \? "Anonymous review" : "Identity visible"/);
});
