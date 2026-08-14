import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");

const panel = await readFile(resolve(root, "src/ui/comms/DemoMailAllowlist.tsx"), "utf8");
const screen = await readFile(resolve(root, "src/ui/comms/CommsScreen.tsx"), "utf8");
const css = await readFile(resolve(root, "src/ui/comms/comms.css"), "utf8");

/**
 * The prose an organizer actually reads: the explanation, the heading, the
 * label, the empty state, and every sentence the note can hold. Identifiers and
 * class names are code, not copy, so they are deliberately not in here.
 */
const OPERATOR_COPY = [
  ...panel.matchAll(/<(p|h2|label)\b[^>]*>([\s\S]*?)<\/\1>/g),
].map((match) => match[2])
  .concat([...panel.matchAll(/text: (?:`|")([^`"]*)(?:`|")/g)].map((match) => match[1]))
  .join(" ");

test("CONTRACT · the allowlist says what it does in the operator's language, not the schema's", async () => {
  assert.ok(OPERATOR_COPY.length > 400, "the operator-facing copy was not found to check");
  assert.doesNotMatch(OPERATOR_COPY, /allowlist/i, "operator-facing copy must not use the word allowlist");
  assert.doesNotMatch(OPERATOR_COPY, /demo_safe|suppress|event_settings/i, "operator-facing copy must not use schema words");
  assert.match(panel, /written to the outbox below instead of\s*being sent/);
  assert.match(panel, /genuinely leaves the building/);
  assert.match(panel, /Nobody receives real email\./);
});

test("CONTRACT · the consequence of listing an address is visible on the row and at the keyboard", async () => {
  assert.match(panel, /receives real email/);
  assert.match(panel, /Mail addressed here is really sent/);
  assert.match(panel, /Mail to it is really sent\./);
  assert.match(panel, /will now receive real email/);
  assert.match(panel, /no longer receives real email/);
});

test("CONTRACT · an address is validated before it is stored, and the check is stated where it is typed", async () => {
  assert.match(panel, /isAllowlistEmail\(candidate\)/);
  assert.match(panel, /checked before it is saved/);
  assert.match(panel, /is not a complete email address/);
  // One predicate on both sides of the wire, so the browser never accepts what the server refuses.
  const shared = await readFile(resolve(root, "src/lib/demo-mail-allowlist.ts"), "utf8");
  assert.match(shared, /export function isAllowlistEmail/);
  const routes = await readFile(resolve(root, "src/routes/comms.routes.ts"), "utf8");
  assert.match(routes, /isAllowlistEmail\(email\)/);
});

test("CONTRACT · adding or removing a row cannot move the controls beside it", async () => {
  // The listing is a fixed height and scrolls; it does not grow into the page.
  assert.match(css, /\.allowlist-listing \{[^}]*height: \d+px;/);
  assert.match(css, /\.allowlist-listing \{[^}]*overflow-y: auto;/);
  assert.doesNotMatch(css, /\.allowlist-listing \{[^}]*min-height:/);
  // The note under the input always occupies its two lines, empty or not.
  assert.match(css, /\.allowlist-note \{[^}]*height: \d+px;/);
  // The button keeps its width when its label changes from Add to Saving.
  assert.match(css, /\.allowlist-submit \{[^}]*width: \d+px;/);
  assert.match(css, /\.allowlist-remove \{[^}]*width: \d+px;/);
  // The empty state fills the same box rather than collapsing it.
  assert.match(css, /\.allowlist-empty \{[^}]*height: 100%;/);
});

test("CONTRACT · the outbox banner and the held reason tell the truth about this conference", async () => {
  // A live conference does not wear a demo-safe hat.
  assert.match(screen, /demoMode\s*$/m);
  assert.match(screen, /Live outbox/);
  assert.match(screen, /every one of them is sent to the person it names/);
  assert.match(screen, /\{demoMode && <DemoMailAllowlist eventId=\{eventId\} \/>\}/);
  // The held reason is rendered in words, not as the stored enum.
  assert.match(screen, /demo_mode_not_allowlisted: "held because this address is not on the real-email list"/);
  assert.match(screen, /suppressedReasonWords\(message\.suppressed_reason\)/);
});
