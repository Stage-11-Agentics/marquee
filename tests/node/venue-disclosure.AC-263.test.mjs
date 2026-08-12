import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  displayRoomLabel,
  pinnedBuildingCount,
  showsBuildingComparison,
  showsBuildingComparisonCount,
  visibleVenueConflicts,
} from "../../src/lib/venue-disclosure.ts";

const agendaPage = readFileSync(new URL("../../src/ui/agenda/AgendaPage.tsx", import.meta.url), "utf8");
const disclosure = readFileSync(new URL("../../src/lib/venue-disclosure.ts", import.meta.url), "utf8");
const portalPage = readFileSync(new URL("../../src/ui/portal/PortalPage.tsx", import.meta.url), "utf8");
const submissionsPage = readFileSync(new URL("../../src/ui/submissions/SubmissionsPage.tsx", import.meta.url), "utf8");
const venuesPage = readFileSync(new URL("../../src/ui/venues/VenuesPage.tsx", import.meta.url), "utf8");
const publicSite = readFileSync(new URL("../../src/lib/public-site.ts", import.meta.url), "utf8");

const oneBuilding = [{ id: "hotel", lat: 40.7625, lng: -73.9814 }];
const twoBuildings = [...oneBuilding, { id: "annex", lat: 40.7586, lng: -73.9862 }];

test("AC-263 · comparison threshold is false for one pin and true for two distinct pins", () => {
  assert.equal(pinnedBuildingCount(oneBuilding), 1);
  assert.equal(showsBuildingComparison(oneBuilding), false);
  assert.equal(showsBuildingComparisonCount(1), false);
  assert.equal(displayRoomLabel("Room 101", "Hotel", false), "Room 101");

  assert.equal(pinnedBuildingCount(twoBuildings), 2);
  assert.equal(showsBuildingComparison(twoBuildings), true);
  assert.equal(showsBuildingComparisonCount(2), true);
  assert.equal(displayRoomLabel("Room 101", "Hotel", true), "Room 101 · Hotel");

  const conflicts = [{ kind: "room" }, { kind: "transit" }];
  assert.deepEqual(visibleVenueConflicts(conflicts, false), [{ kind: "room" }]);
  assert.deepEqual(visibleVenueConflicts(conflicts, true), conflicts);
});

test("AC-263 · presentation folds comparison while retaining instruction surfaces", () => {
  assert.match(agendaPage, /visibleVenueConflicts/);
  assert.match(disclosure, /conflict\.kind !== "transit"/);
  assert.match(agendaPage, /agendaBuildingHeader/);
  assert.match(agendaPage, /displayRoomLabel\(session\.room, session\.building/);
  assert.match(venuesPage, /<details class="venue-map-fold"/);
  assert.match(venuesPage, /venue-map-reserved/);
  assert.match(venuesPage, /aria-label="Building entrance note"/);
  assert.match(portalPage, /show_building_comparison/);
  assert.match(portalPage, /location\.access_note/);
  assert.match(portalPage, /location\.access_minutes/);
  assert.doesNotMatch(portalPage, /portal-arrival-map-fold/);
  assert.match(portalPage, /<VenueMap buildings=/);
  assert.match(portalPage, /portal-arrival-map-directions/);
  assert.match(submissionsPage, /singleVenueName/);
  assert.match(publicSite, /showBuildingComparison \? roomDisplayLabel/);
});
