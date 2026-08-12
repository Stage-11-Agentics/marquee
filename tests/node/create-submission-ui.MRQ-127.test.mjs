import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const source = async (path) => readFile(new URL(path, root), "utf8");

test("CONTRACT · MRQ-127 create submission uses live settings pickers and a required submitter", async () => {
  const create = await source("src/ui/submissions/CreateSubmissionPage.tsx");

  assert.match(create, /FORMATS_ROUTE = "\/api\/v1\/events\/\{eventId\}\/formats"/);
  assert.match(create, /TRACKS_ROUTE = "\/api\/v1\/events\/\{eventId\}\/tracks"/);
  assert.match(create, /<select id="submission-tracks" multiple/);
  assert.match(create, /selected=\{trackIds\.includes\(track\.id\)\}/);
  assert.match(create, /<select id="submission-format"/);
  assert.match(create, /<legend>Submitter <span class="required-mark">Required<\/span><\/legend>/);
  assert.match(create, /Choose existing person/);
  assert.match(create, /Create new person/);
  assert.doesNotMatch(create, /track_agents|format_talk/);
});

test("CONTRACT · MRQ-127 every agenda drop target is labelled without creating landmarks", async () => {
  const agenda = await source("src/ui/agenda/AgendaPage.tsx");
  const tracks = await source("src/ui/agenda/track-board.tsx");

  for (const sourceText of [agenda, tracks]) {
    assert.match(sourceText, /role="group"/);
    assert.match(sourceText, /aria-label=\{ariaLabel\}/);
    assert.doesNotMatch(sourceText, /role="region"/);
  }
  assert.equal((agenda.match(/<DropCell/g) ?? []).length, 3);
  assert.equal((tracks.match(/<DropCell/g) ?? []).length, 1);
});
