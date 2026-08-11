import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");

test("CONTRACT · Reset demo is a real queued action with honest pending state and a reserved slot", async () => {
  const appShell = await readFile(resolve(root, "src/ui/shell/AppShell.tsx"), "utf8");
  const sidebar = await readFile(resolve(root, "src/ui/shell/Sidebar.tsx"), "utf8");
  const styles = await readFile(resolve(root, "src/styles/components.css"), "utf8");

  assert.match(appShell, /fetch\(["']\/api\/v1\/admin\/reset-demo["']/);
  assert.match(appShell, /window\.confirm\(/);
  assert.match(appShell, /reset-demo\/.*encodeURIComponent/);
  assert.match(appShell, /Resetting demo/);
  assert.match(appShell, /The demo reset timed out/);
  assert.match(appShell, /<ToastHost message=\{toast\}/);
  assert.doesNotMatch(sidebar, /unavailable\(["']Reset demo/);
  assert.match(sidebar, /disabled=\{resetting\}/);
  assert.match(sidebar, /aria-busy=\{resetting\}/);
  assert.match(sidebar, /Resetting…/);
  assert.match(styles, /\.sidebar-foot \.reset-demo-button[^\n]*height: 30px/);
  assert.match(styles, /\.sidebar-foot \.reset-demo-button[^\n]*min-height: 30px/);
  assert.match(styles, /\.reset-demo-label[^\n]*min-width: 12ch/);
});
