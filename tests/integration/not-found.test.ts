import { expect, test } from "vitest";

import { app, type Env } from "../../src/index";
import { env } from "./apply-migrations";
import { routeTable } from "../../src/ui/shell/route-table";

/**
 * The site had no 404. `not_found_handling: "single-page-application"` answered
 * every asset miss with index.html under a 200, so `/program`, `/nonsense/deep`
 * and a real page were the same response to anything reading a status code —
 * which is how a dead link reached the README, and how a browsing agent spends
 * a turn on a URL that was never a page.
 *
 * The fix moves the decision into the Worker, which is exactly why this file can
 * see it: these tests call `app.fetch` directly, and wrangler.jsonc is invisible
 * from here. The ASSETS stub therefore emulates the config it now depends on —
 * `"none"` — where a miss 404s instead of becoming a shell.
 */
const SHELL = `<!doctype html><html><head><title>Marquee</title></head><body><div id="app"></div></body></html>`;

/** `"none"`: real assets are served, misses 404. Only `/index.html` exists here. */
const assets = {
  fetch: async (request: Request) =>
    new URL(request.url).pathname === "/index.html"
      ? new Response(SHELL, { headers: { "content-type": "text/html" } })
      : new Response("Not Found", { status: 404 }),
} as unknown as Fetcher;

async function request(path: string): Promise<Response> {
  return app.request(path, {}, { ...env, ASSETS: assets } as unknown as Env);
}

test("CONTRACT · an unknown path is a 404, not a 200 shell", async () => {
  for (const path of ["/this-route-does-not-exist", "/nonsense/deep/path", "/program", "/settings/webhooks"]) {
    const response = await request(path);
    expect(response.status, `${path} must not answer 200`).toBe(404);
    expect(await response.text()).toContain("That page does not exist.");
  }
});

test("CONTRACT · the 404 does not boot the admin shell over itself", async () => {
  const body = await (await request("/this-route-does-not-exist")).text();
  // The marker `app.tsx` reads to leave the document alone. Without it the shell
  // mounts, finds no session, and draws "Your session ended" on a public 404.
  expect(body).toContain('data-marquee-page="not-found"');
});

/**
 * The hard half. Client-side routes are rendered by the SPA and named nowhere in
 * wrangler.jsonc's `run_worker_first`, so a naive 404 would delete large parts of
 * a working product. Every non-external row of the SPA's own route table has to
 * survive — and the table is read here rather than copied, so a screen added
 * tomorrow is covered without editing this file.
 */
test("CONTRACT · every client-side route still serves the app shell", async () => {
  const clientPaths = routeTable
    .filter((route) => !route.external && !route.path.startsWith("/api/"))
    .map((route) => route.path.replace(/:[^/]+/g, "sample-id"));
  expect(clientPaths.length).toBeGreaterThan(20);

  for (const path of clientPaths) {
    const response = await request(path);
    expect(response.status, `${path} must still be a page`).not.toBe(404);
  }
});

test("CONTRACT · a real static asset is still served untouched", async () => {
  const response = await request("/index.html");
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(SHELL);
});
