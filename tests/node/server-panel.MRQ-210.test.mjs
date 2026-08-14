import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const source = async (path) => readFile(new URL(path, root), "utf8");

test("CONTRACT · the standalone server route mounts the shared panel and redirects the legacy path", async () => {
  const page = await source("src/ui/settings/ServerPage.tsx");
  const panel = await source("src/ui/setup/ServerPanel.tsx");
  const instance = await source("src/ui/setup/InstancePanel.tsx");
  const config = await source("src/lib/mail/config.ts");
  const appShell = await source("src/ui/shell/AppShell.tsx");
  const orgSettings = await source("src/ui/org/OrgSettingsPage.tsx");
  const routeTable = await source("src/ui/shell/route-table.ts");
  const wrangler = await source("wrangler.jsonc");

  assert.match(page, /title="Server"/);
  assert.match(panel, /What this Marquee is connected to, and whether each piece is working\./);
  assert.match(page, /No passwords, ever/);
  assert.match(page, /Re-running the setup command[\s\S]*fresh one-time claim link/);
  assert.match(page, /<ServerPanel \/>/);
  assert.match(panel, /Email sending[\s\S]*File uploads[\s\S]*Spam protection[\s\S]*Web address/);
  assert.match(panel, /working/);
  assert.match(panel, /not set up/);
  assert.match(panel, /Open Resend ↗/);
  assert.match(config, /RESEND_ACCOUNT_NAME/);
  assert.match(wrangler, /"RESEND_API_KEY",\s*"RESEND_ACCOUNT_NAME",/);
  assert.match(instance, /<ServerPanel showDemoControls \/>/);
  assert.match(routeTable, /path: "\/org\/server"/);
  assert.match(routeTable, /path: "\/org\/instance"/);
  assert.match(appShell, /navigate\("\/org\/server", \{ replace: true \}\)/);
  // MRQ-207 folded the standalone Server route into the Organization settings
  // tabs, so the mount moved from the shell to that surface — which is what
  // ServerPage's own note anticipated. The assertion follows the mount; what it
  // asserts is unchanged, and /org/instance still redirects to /org/server above.
  assert.match(orgSettings, /<ServerPage \/>/);
});
