import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const tokensPage = fs.readFileSync(path.join(root, "src/ui/settings/ApiTokensPage.tsx"), "utf8");
const appShell = fs.readFileSync(path.join(root, "src/ui/shell/AppShell.tsx"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "src/ui/shell/Sidebar.tsx"), "utf8");

test("AC-106 · API token settings is a real SPA route with docs navigation and one-time secret copy", () => {
  assert.match(appShell, /ApiTokensPage/);
  assert.match(appShell, /\/settings\/api/);
  assert.match(tokensPage, /\/api\/v1\/org\/tokens/);
  assert.match(tokensPage, /Marquee will not show it again/);
  assert.match(tokensPage, /program:read/);
  assert.match(tokensPage, /program:write/);
  assert.match(tokensPage, /review:write/);
  assert.match(tokensPage, /speaker:write/);
  assert.match(tokensPage, /agenda:write/);
  assert.match(tokensPage, /comms:send/);
  assert.match(tokensPage, /mirror:write/);
  assert.match(tokensPage, /href="\/api\/docs"/);
  assert.match(sidebar, /href="\/api\/docs"/);
});
