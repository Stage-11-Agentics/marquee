#!/usr/bin/env node

/**
 * Regenerates the landing page's theme thumbnails (public/themes/<id>.webp).
 *
 * Each thumbnail is a real screenshot of the organizer program home wearing one
 * theme, taken against a live deployment via the `?theme=` comparison override
 * — the previews promise "this is exactly what you get", so they must never be
 * mockups. Re-run whenever a theme's look changes:
 *
 *   node scripts/capture-theme-thumbnails.mjs                # against production
 *   MARQUEE_THUMB_URL=http://localhost:5173 node scripts/... # against local dev
 *
 * Requires Playwright's Chromium (`npx playwright install chromium`) and
 * cwebp on PATH. The theme list mirrors src/ui/shell/theme.ts.
 */

import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { chromium } from "@playwright/test";

const execFileAsync = promisify(execFile);

const BASE_URL = process.env.MARQUEE_THUMB_URL ?? "https://marquee.stage11.dev";
const THEME_IDS = ["day", "night", "latent-space", "ai-engineer", "swyxy"];
const OUTPUT_DIRECTORY = resolve(import.meta.dirname, "../public/themes");
// Captured at the desktop reference viewport, served at half size: the cards
// render ~250px wide, so 720px is crisp on a 2–3× display without shipping a
// megabyte of hero imagery above the fold.
const VIEWPORT = { width: 1440, height: 900 };
const SERVED_WIDTH = 720;

await mkdir(OUTPUT_DIRECTORY, { recursive: true });

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const seat = await context.request.post(`${BASE_URL}/api/v1/auth/demo`, {
    data: { role: "organizer" },
  });
  if (!seat.ok()) throw new Error(`demo organizer seat refused: ${seat.status()}`);

  const page = await context.newPage();
  for (const id of THEME_IDS) {
    // `mode=light` pins swyxy's palette so a stored dark toggle on the capture
    // machine can never leak into the published preview.
    await page.goto(`${BASE_URL}/submissions?theme=${id}&mode=light`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    // Register themes animate chrome in; let the screen settle.
    await page.waitForTimeout(600);
    const raw = resolve(OUTPUT_DIRECTORY, `${id}.png`);
    const final = resolve(OUTPUT_DIRECTORY, `${id}.webp`);
    await page.screenshot({ path: raw });
    await execFileAsync("cwebp", ["-quiet", "-q", "82", "-resize", String(SERVED_WIDTH), "0", raw, "-o", final]);
    await rm(raw);
    console.log(`captured ${id}.webp`);
  }
} finally {
  await browser.close();
}
