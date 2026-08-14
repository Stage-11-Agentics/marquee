import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "vitest";

import { conferenceNameMatches } from "../../src/ui/settings/delete-conference";

const settingsSource = readFileSync(resolve(process.cwd(), "src/ui/settings/EventSettings.tsx"), "utf8");
const settingsCss = readFileSync(resolve(process.cwd(), "src/ui/settings/settings.css"), "utf8");

test("AC-302 · the exact conference name is the only unlock arm", () => {
  expect(conferenceNameMatches("AI Engineer NYC", "AI Engineer NYC")).toBe(true);
  expect(conferenceNameMatches("  AI Engineer NYC  ", "AI Engineer NYC")).toBe(true);
  expect(conferenceNameMatches("ai engineer nyc", "AI Engineer NYC")).toBe(false);
  expect(conferenceNameMatches("AI Engineer NYC!", "AI Engineer NYC")).toBe(false);
  expect(conferenceNameMatches("AI Engineer NY", "AI Engineer NYC")).toBe(false);
  expect(conferenceNameMatches("", "AI Engineer NYC")).toBe(false);
});

test("AC-303 · the settings surface reproduces the ruled Danger zone disclosure", () => {
  expect(settingsSource).toContain("Delete conference…");
  expect(settingsSource).toContain("Deleting removes everything scoped to this conference. People, notes, tags, and outreach are organization-level and stay in the CRM.");
  expect(settingsSource).toContain("Dies with the conference");
  expect(settingsSource).toContain("Abstracts and sessions · forms and their public links · agenda and conference site · speaker portal access · queued calendar invites");
  expect(settingsSource).toContain("Stays");
  expect(settingsSource).toContain("People, notes, tags, and outreach — organization-level, untouched.");
  expect(settingsSource).toContain("This removes the conference and everything scoped to it. It cannot be undone.");
  expect(settingsSource).toContain("disabled={deleteBusy || !conferenceNameMatches(deleteName, model.event.name)}");
  expect(settingsCss).toContain(".settings-danger-card");
  expect(settingsCss).toContain(".settings-danger-modal");
});
