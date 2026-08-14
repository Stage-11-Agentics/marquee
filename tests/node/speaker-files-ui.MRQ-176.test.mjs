import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panel = await readFile(new URL("../../src/ui/speakers/SpeakerFilesPanel.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../../src/ui/speakers/speakers.css", import.meta.url), "utf8");

test("CONTRACT · MRQ-176 · the speaker files panel names deliverables and profile photos separately", () => {
  assert.match(panel, /<strong>Requested deliverables<\/strong>/);
  assert.match(panel, /<strong>Profile photo<\/strong>/);
  assert.match(panel, /group\.kind === "headshot"/);
  assert.doesNotMatch(panel, /requested file\$\{files\.expected/);
  assert.match(styles, /\.speaker-files-summary[^{]*\{[^}]*min-height: 34px/);
});
