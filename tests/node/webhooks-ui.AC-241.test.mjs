import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const source = async (path) => readFile(new URL(path, root), "utf8");

test("AC-241 · webhook settings is a real organizer surface with honest test-send boundaries", async () => {
  const page = await source("src/ui/settings/WebhooksPage.tsx");
  const shell = await source("src/ui/shell/AppShell.tsx");
  const routes = await source("src/ui/shell/route-table.ts");
  const styles = await source("src/ui/settings/settings.css");

  assert.match(routes, /path: "\/settings\/webhooks", label: "Webhooks", icon: "", group: "utility"/);
  assert.match(shell, /import \{ WebhooksPage \} from "\.\.\/settings\/WebhooksPage"/);
  assert.match(shell, /route\?\.id === "webhooks" \? <WebhooksPage eventId=\{eventId\} navigate=\{navigate\} \/>/);
  assert.match(page, /\/api\/v1\/events\/\$\{encodeURIComponent\(eventId\)\}\/webhooks/);
  assert.match(page, /Send signed test/);
  assert.match(page, /Marquee stores only a hash/);
  assert.match(page, /event-triggered dispatcher and WEBHOOK_QUEUE consumer are a follow-up/);
  assert.match(page, /type="password"/);
  assert.match(styles, /\.webhook-boundary/);
  assert.match(styles, /\.webhook-delivery-table/);
});
