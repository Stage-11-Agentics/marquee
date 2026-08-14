/**
 * MRQ-140 · the assignment UI has to send the session, not just the people.
 *
 * The API accepted a session all along; the picker never named one, which is
 * exactly the kind of defect a route-level test cannot see. These assertions
 * pin the two doors — creating a task with assignees, and assigning an existing
 * one — to a body that carries `session_assignments`.
 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const page = fs.readFileSync(path.join(root, "src/ui/settings/TaskTemplatesPage.tsx"), "utf8");
const styles = fs.readFileSync(path.join(root, "src/ui/settings/settings.css"), "utf8");

test("CONTRACT · MRQ-140 · both assignment doors send the session with the people", () => {
  const bodies = page.match(/session_assignments: sessionAssignments\(assignees, [^)]+\)/g) ?? [];
  assert.equal(bodies.length, 2, "create and assign must both carry session_assignments");
  assert.match(page, /session_assignments: sessionAssignments\(assignees, draft\.assignTo, draft\.sessionChoices\)/);
  assert.match(page, /session_assignments: sessionAssignments\(assignees, assignSelection, assignSessions\)/);
});

test("CONTRACT · MRQ-140 · a speaker with one session is answered before the organizer arrives", () => {
  assert.match(page, /return person\.sessions\.length === 1 \? \(person\.sessions\[0\] as SessionOption\)\.id : ""/);
});

test("CONTRACT · MRQ-140 · the picker offers a session per selected speaker, and 'no session' stays sayable", () => {
  assert.match(page, /function SessionChoicePicker\(/);
  // Both doors, whatever else they hand the picker: the claim is that each one
  // gets a session control for the speakers it selected, not that the prop list
  // has stayed the same length since MRQ-140.
  assert.match(page, /<SessionChoicePicker assignees=\{assignees\}[^>]*selected=\{draft\.assignTo\}/);
  assert.match(page, /<SessionChoicePicker assignees=\{assignees\}[^>]*selected=\{assignSelection\}/);
  assert.match(page, /<option value="">No session<\/option>/);
  assert.match(page, /aria-label=\{`Session for \$\{[^`]*person\.name[^`]*\}`\}/);
});

test("CONTRACT · MRQ-140 · the session rows hold their height when their caption changes", () => {
  assert.match(styles, /\.task-session-row[^\n]*min-height: 44px/);
});
