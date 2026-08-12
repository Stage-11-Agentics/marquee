/**
 * The half of the 404 fix no request-level test can reach.
 *
 * `wrangler.jsonc` decides whether an asset miss ever reaches the Worker at all.
 * The integration suite calls `app.fetch` directly and never consults it, so
 * `not_found_handling: "single-page-application"` could be restored tomorrow and
 * every other test would stay green while the whole site went back to answering
 * 200 with a 3,375-byte shell for `/program`, `/nonsense/deep/path`, and every
 * dead link anyone ever published. This file is the only thing standing there.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const wrangler = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
const index = readFileSync(new URL("../../src/index.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../../src/ui/app.tsx", import.meta.url), "utf8");
const notFound = readFileSync(new URL("../../src/routes/not-found.route.tsx", import.meta.url), "utf8");

test("CONTRACT · asset misses reach the Worker instead of becoming a 200 shell", () => {
  assert.match(wrangler, /"not_found_handling":\s*"none"/);
  assert.doesNotMatch(wrangler, /"not_found_handling":\s*"single-page-application"/);
});

test("CONTRACT · the terminal handler decides, rather than proxying every miss to ASSETS", () => {
  assert.match(index, /app\.all\("\*",\s*serveAssetOrNotFound\)/);
  // The line this replaced. It is what made every unmatched path a 200.
  assert.doesNotMatch(index, /app\.all\("\*",\s*\(context\)\s*=>\s*context\.env\.ASSETS\.fetch/);
});

test("CONTRACT · the client-route set is derived from the SPA's own table, never hand-listed", () => {
  assert.match(notFound, /import \{ matchRoute \} from "\.\.\/ui\/shell\/route-table"/);
  assert.match(notFound, /matchRoute\(pathname, search\) !== undefined/);
});

test("CONTRACT · the shell does not mount over a server-rendered answer", () => {
  assert.match(notFound, /data-marquee-page="not-found"/);
  assert.match(app, /root\.dataset\.marqueePage !== undefined/);
  assert.match(app, /!isPublicPage && !isServerRenderedPage/);
});
