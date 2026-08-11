import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const source = fs.readFileSync(path.join(root, "src/ui/settings/EventSettings.tsx"), "utf8");

test("AC-7 · Save event settings submits in place and reports the result without a page reload", () => {
  assert.ok(source.includes("event.preventDefault()"));
  assert.ok(source.includes("Save event settings"));
  assert.ok(source.includes('setNotice("Conference settings saved")'));
  assert.ok(!source.includes("window.location"));
});

test("AC-13 · the settings surface has one Venues handoff and no venue editors", () => {
  assert.ok(source.includes("loadVenueModel(eventId)"));
  assert.ok(source.includes('navigate("/settings/venues")'));
  assert.ok(source.includes("Open Venues →"));
  assert.ok(source.includes("buildings · ${venueCounts.rooms} rooms"));
  assert.ok(!source.includes("building-editor"));
  assert.ok(!source.includes("room-editor"));
  assert.ok(!source.includes("av_capabilities"));
});
