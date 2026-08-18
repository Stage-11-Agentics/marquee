import { expect, test } from "vitest";

import { app, type Env } from "../../src/index";

/**
 * "The conference site" is published as /site, and the app shell's router has
 * no such route — so without a Worker route it falls through to the shell and
 * renders "Route not found" on a page that is live at /agenda. This exercises
 * the real Worker, because the dev server's SPA fallback answers /site itself
 * and would report a false pass.
 */
const SHELL = `<!doctype html><html><head><title>Marquee</title></head><body><div id="app"></div></body></html>`;
const assets = { fetch: async () => new Response(SHELL, { headers: { "content-type": "text/html" } }) } as unknown as Fetcher;
const testEnv = { ASSETS: assets } as unknown as Env;

async function request(path: string): Promise<Response> {
  return app.request(path, {}, testEnv);
}

test("CONTRACT · /site is answered by the Worker, not the app shell", async () => {
  const response = await request("/site");
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/agenda");
});

test("CONTRACT · /site carries its filters across to the agenda", async () => {
  const response = await request("/site?day=2&track=platform");
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/agenda?day=2&track=platform");
});
