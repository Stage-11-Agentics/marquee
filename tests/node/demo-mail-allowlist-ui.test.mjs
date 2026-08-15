import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

/**
 * What is left here is only what source inspection can honestly claim.
 *
 * The behaviour of the panel — that rows live inside a fixed-height box, that
 * the empty state fills it, that an invalid address is refused and never sent,
 * that a rejection is bounded — is asserted against the mounted component in
 * `tests/unit/demo-mail-allowlist-panel.test.ts`. It used to be asserted here
 * by regex over the source, and a review showed what that was worth: deleting
 * `class="allowlist-listing"` disconnected the only rule fixing the listing's
 * height and every test in this file still passed. Those assertions moved
 * rather than being kept in two places.
 *
 * `CommsScreen` is the exception, and deliberately so: mounting it means
 * standing up templates, audience, preview and outbox fetches to assert one
 * conditional, so its wiring is pinned as an expression here. That is a weaker
 * instrument, and this comment is the honest label on it.
 */

const root = resolve(import.meta.dirname, "../..");
const screen = await readFile(resolve(root, "src/ui/comms/CommsScreen.tsx"), "utf8");

test("CONTRACT · the outbox banner and the held reason tell the truth about this conference", async () => {
  // A live conference does not wear a demo-safe hat. Pin the wiring, not the
  // identifier: `demoMode` existing somewhere in the file proves nothing.
  assert.match(screen, /const demoMode = useEventContext\(\)\.event\?\.demo_mode === 1;/);
  assert.match(screen, /\{demoMode && <DemoMailAllowlist eventId=\{eventId\} \/>\}/);
  assert.match(screen, /Live outbox/);
  assert.match(screen, /every one of them is sent to the person it names/);
  // The demo banner must not claim universal suppression: a public submitter's
  // confirmation is written `always_live` and bypasses the list entirely.
  assert.match(screen, /a public submitter's own confirmation always is/);
  // The held reason is rendered in words, not as the stored enum.
  assert.match(screen, /demo_mode_not_allowlisted: "held because this address is not on the real-email list"/);
  assert.match(screen, /suppressedReasonWords\(message\.suppressed_reason\)/);
});
