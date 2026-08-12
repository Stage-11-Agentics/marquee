import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const portalPage = readFileSync(new URL("../../src/ui/portal/PortalPage.tsx", import.meta.url), "utf8");
const portalCss = readFileSync(new URL("../../src/ui/portal/portal.css", import.meta.url), "utf8");

test("CONTRACT · MRQ-91 · speaker arrival map is real, named, fixed, and has one Directions action", () => {
  assert.doesNotMatch(portalPage, /Pinned venue/);
  assert.doesNotMatch(portalPage, /portal-arrival-map-fold/);
  assert.doesNotMatch(portalCss, /portal-arrival-map-fold/);
  assert.match(portalPage, /location\.(?:building|address)\?\.trim\(\)/);
  assert.match(portalPage, /<VenueMap\b/);
  assert.match(portalPage, /The conference team has not pinned this building\./);
  assert.match(portalPage, /google\.com\/maps\/search/);
  assert.match(portalPage, /target="_blank"/);
  assert.equal((portalPage.match(/Directions ↗/g) ?? []).length, 1);
  assert.match(portalPage, /MAP_HEIGHT/);
  assert.match(portalPage, /role="group"/);
  assert.match(portalCss, /\.portal-arrival-map \{[^}]*overflow: hidden/);
  assert.match(portalCss, /\.portal-arrival-map-directions \{[^}]*top: 12px/);
  assert.match(portalCss, /\.portal-arrival-map\.empty \{/);
});
