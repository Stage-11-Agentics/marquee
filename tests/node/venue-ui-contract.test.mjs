import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const venuesPage = readFileSync(new URL("../../src/ui/venues/VenuesPage.tsx", import.meta.url), "utf8");
const map = readFileSync(new URL("../../src/ui/venues/VenueMap.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("../../src/ui/settings/EventSettings.tsx", import.meta.url), "utf8");
const submissionsPage = readFileSync(new URL("../../src/ui/submissions/SubmissionsPage.tsx", import.meta.url), "utf8");
const submissionsStyles = readFileSync(new URL("../../src/ui/submissions/submissions.css", import.meta.url), "utf8");

test("AC-252 · scheduler-facing room labels include their building", () => {
  assert.match(submissionsPage, /item\.slot\.show_building \? ` · \$\{item\.slot\.building\}`/);
  assert.match(submissionsPage, /<span class="chip slot-chip" title=\{slot\}><span>\{slot\}<\/span><\/span>/);
  assert.match(submissionsStyles, /\.slot-chip > span \{ display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; \}/);
});

test("AC-253 · venue authoring exposes AV capability tags and room-local notes", () => {
  assert.match(venuesPage, /const AV_TAGS = \["Projector", "Confidence monitor", "Mics", "Livestream"\]/);
  assert.match(venuesPage, /aria-label=\"Room notes\"/);
  assert.match(venuesPage, /toggleAv/);
  assert.match(venuesPage, /saveVenueModel/);
});

test("AC-257 · the venue map reserves its box, uses plain OSM images, and degrades to pins and lines", () => {
  assert.match(map, /const MAP_HEIGHT = 360/);
  assert.match(map, /<img class=\"venue-map-tile\"/);
  assert.match(map, /tile\.openstreetmap\.org/);
  assert.match(map, /onError=\{\(\) => setTilesFailed\(true\)\}/);
  assert.match(map, /venue-map-walk-line/);
  assert.match(map, /venue-map-walk-label/);
  assert.match(map, /OpenStreetMap contributors/);
  assert.doesNotMatch(`${venuesPage}\n${map}`, /leaflet|mapbox|google maps|api[_-]?key|cdn/i);
  assert.doesNotMatch(settings, /data-building-|data-room-/);
});
