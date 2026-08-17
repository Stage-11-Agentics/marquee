import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");

test("AC-282 + AC-283 · the onboarding speaker surface exposes single and bulk portal invites", async () => {
  const source = await readFile(resolve(root, "src/ui/onboarding/OnboardingPage.tsx"), "utf8");
  assert.match(source, /Invite to portal/);
  // MRQ-277 D7: the count is the recipients the invite can actually reach, not
  // every ticked row — the board also chases sponsor contacts, who hold no
  // speaker seat and whose invitation the portal would refuse.
  assert.match(source, /Invite to portal \(\$\{invitableSelectedRows\.length\}\)/);
  assert.match(source, /const invitableSelectedRows = selectedRows\.filter\(\(row\) => row\.portal_invitable\)/);
  assert.match(source, /\/api\/v1\/events\/\$\{encodeURIComponent\(eventId\)\}\/speakers\/invite/);
  assert.match(source, /outbox row .*delivery remains provider-controlled/);
});

test("AC-110 + AC-113 · the import surface names speakers-only mode and does not require external_ref", async () => {
  const page = await readFile(resolve(root, "src/ui/import/SessionizeImportPage.tsx"), "utf8");
  const importer = await readFile(resolve(root, "src/lib/sessionize-import.ts"), "utf8");
  assert.match(page, /Sessions CSV <small>\(optional\)<\/small>/);
  assert.match(page, /Speakers CSV <small>\(required\)<\/small>/);
  assert.match(page, /const requiredSpeakers = \["name", "email"\]/);
  assert.match(page, /External reference is optional/);
  assert.match(importer, /sessions_csv\?: string/);
  assert.match(importer, /manifest\.sessions_csv \?\? ""/);
});

test("AC-282 + AC-283 · invite API is organizer-authenticated and event-scoped", async () => {
  const source = await readFile(resolve(root, "src/routes/speaker-invites.routes.ts"), "utf8");
  assert.match(source, /path: "\/api\/v1\/events\/\{eventId\}\/speakers\/invite"/);
  assert.match(source, /kind: "grants", grants: \["program:write"\]/);
  assert.match(source, /UPDATE participations SET invited_at/);
  // The eligibility predicate itself moved to one definition (MRQ-277 D6/D7),
  // so the board can say on the row what the write will do. Follow it there
  // rather than pinning a copy of the SQL that no longer exists here.
  assert.match(source, /portalInvitablePersonSource\("\?"\)/);
  assert.match(source, /from "\.\.\/lib\/roster-source"/);
  const rosterSource = await readFile(resolve(root, "src/lib/roster-source.ts"), "utf8");
  assert.match(rosterSource, /export function portalInvitablePersonSource/);
  assert.match(rosterSource, /invitable_seat\.event_id = \$\{eventIdExpression\}/);
  assert.match(rosterSource, /invitable_seat\.role = 'speaker'/);
  assert.match(rosterSource, /invitable_submission\.event_id = \$\{eventIdExpression\}/);
});
