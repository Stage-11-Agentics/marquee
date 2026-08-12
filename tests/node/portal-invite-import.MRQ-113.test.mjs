import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");

test("SPK-06 · the onboarding speaker surface exposes single and bulk portal invites", async () => {
  const source = await readFile(resolve(root, "src/ui/onboarding/OnboardingPage.tsx"), "utf8");
  assert.match(source, /Invite to portal/);
  assert.match(source, /Invite to portal \(\$\{selectedRows\.length\}\)/);
  assert.match(source, /\/api\/v1\/events\/\$\{encodeURIComponent\(eventId\)\}\/speakers\/invite/);
  assert.match(source, /outbox row .*delivery remains provider-controlled/);
});

test("SPK-03 · the import surface names speakers-only mode and does not require external_ref", async () => {
  const page = await readFile(resolve(root, "src/ui/import/SessionizeImportPage.tsx"), "utf8");
  const importer = await readFile(resolve(root, "src/lib/sessionize-import.ts"), "utf8");
  assert.match(page, /Sessions CSV <small>\(optional\)<\/small>/);
  assert.match(page, /Speakers CSV <small>\(required\)<\/small>/);
  assert.match(page, /const requiredSpeakers = \["name", "email"\]/);
  assert.match(page, /External reference is optional/);
  assert.match(importer, /sessions_csv\?: string/);
  assert.match(importer, /manifest\.sessions_csv \?\? ""/);
});

test("SPK-06 · invite API is organizer-authenticated and event-scoped", async () => {
  const source = await readFile(resolve(root, "src/routes/speaker-invites.routes.ts"), "utf8");
  assert.match(source, /path: "\/api\/v1\/events\/\{eventId\}\/speakers\/invite"/);
  assert.match(source, /kind: "grants", grants: \["program:write"\]/);
  assert.match(source, /m\.event_id = \? AND m\.person_id = p\.id AND m\.role = 'speaker'/);
  assert.match(source, /s\.event_id = \? AND pa\.person_id = p\.id/);
  assert.match(source, /UPDATE participations SET invited_at/);
});
