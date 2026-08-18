import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * MRQ-285 drive — the day-of loop in a real browser.
 *
 * Organizer mints a named check-in link; a volunteer opens it with no session
 * at all, on a phone-sized screen, and marks a speaker in; the organizer's own
 * green room shows the mark on its next load; the link is revoked and becomes
 * an ordinary not-found.
 *
 * Opt-in, like every other artifact-producing drive here: it writes real
 * credentials and real arrivals, so it must never run against whatever base URL
 * the contract suite happens to be pointed at.
 */

const EVENT = process.env.DRIVE_EVENT ?? "evt_aie-ny-2026";
const LINK_NAME = process.env.DRIVE_LINK_NAME ?? "Playwright, stage door";
const PHONE = { width: 390, height: 844 };

async function signInAsOrganizer(page: Page): Promise<void> {
  const response = await page.request.post("/api/v1/auth/demo", { data: { role: "organizer" } });
  expect(response.ok()).toBeTruthy();
}

async function openLink(browser: Browser, url: string) {
  const context = await browser.newContext({ viewport: PHONE });
  const page = await context.newPage();
  await page.goto(url);
  return { context, page };
}

test.describe.configure({ timeout: 300_000 });

const DRIVE_DAY_OF = process.env.DRIVE_DAY_OF;
if (DRIVE_DAY_OF) test("CONTRACT · MRQ-285 green room, check-in link, slides board", async ({ page, browser, baseURL }) => {
  await signInAsOrganizer(page);

  // 1 — the organizer's own green room, phone-sized, with the day's rooms.
  await page.setViewportSize(PHONE);
  await page.goto("/green-room");
  await expect(page.locator("[data-green-room]")).toBeVisible();
  await expect(page.locator(".gr-room").first()).toBeVisible();
  await page.screenshot({ path: "artifacts/mrq-285/01-green-room-390.png", fullPage: true });
  // Nothing may overflow the phone: a horizontal scrollbar here is the defect
  // this width exists to catch.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // 2 — the day-of desk: mint a named check-in link.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/day-of");
  await expect(page.locator(".dayof-table")).toBeVisible();
  await page.screenshot({ path: "artifacts/mrq-285/02-slides-board.png", fullPage: true });
  await page.getByLabel("Who this link is for").fill(LINK_NAME);
  await page.getByRole("button", { name: "Make a check-in link" }).click();
  const minted = page.locator(".dayof-minted code");
  await expect(minted).toBeVisible();
  const volunteerUrl = (await minted.innerText()).trim();
  expect(volunteerUrl).toContain("/green-room/k/");

  // 3 — the volunteer, with no session, marks a speaker in.
  const volunteer = await openLink(browser, volunteerUrl);
  await expect(volunteer.page.locator("[data-green-room]")).toBeVisible();
  await expect(volunteer.page.locator(".gr-mark").first()).toBeVisible();
  await volunteer.page.screenshot({ path: "artifacts/mrq-285/03-volunteer-390.png", fullPage: true });
  const away = volunteer.page.locator('.gr-mark[data-state="away"]').first();
  const row = volunteer.page.locator('.gr-speaker').filter({ has: away }).first();
  const sessionId = await row.getAttribute("data-session");
  const personId = await row.getAttribute("data-person");
  await away.click();
  await expect(row.locator(".gr-mark")).toHaveAttribute("data-state", "here");
  await expect(row.locator("[data-stamp]")).toContainText(LINK_NAME);
  await volunteer.page.screenshot({ path: "artifacts/mrq-285/04-marked-390.png", fullPage: true });

  // 4 — the same mark, in the organizer's green room, on the next load.
  await page.setViewportSize(PHONE);
  await page.goto("/green-room");
  const organizerRow = page.locator(`.gr-speaker[data-session="${sessionId}"][data-person="${personId}"]`);
  await expect(organizerRow).toHaveClass(/is-here/);
  await expect(organizerRow.locator("[data-stamp]")).toContainText(LINK_NAME);
  await page.screenshot({ path: "artifacts/mrq-285/05-organizer-sees-mark.png", fullPage: true });

  // 5 — and taking it back removes it.
  await volunteer.page.locator(`.gr-speaker[data-session="${sessionId}"][data-person="${personId}"] .gr-mark`).click();
  await expect(volunteer.page.locator(`.gr-speaker[data-session="${sessionId}"][data-person="${personId}"] .gr-mark`)).toHaveAttribute("data-state", "away");

  // 6 — revoked is not-found, for every copy of the URL at once.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/day-of");
  const linkRow = page.locator(".dayof-link-row").filter({ hasText: LINK_NAME });
  await linkRow.getByRole("button", { name: "Revoke" }).click();
  await expect(linkRow).toHaveCount(0);
  const afterRevoke = await volunteer.page.goto(volunteerUrl);
  expect(afterRevoke?.status()).toBe(404);
  await volunteer.page.screenshot({ path: "artifacts/mrq-285/06-revoked-404.png", fullPage: true });
  await volunteer.context.close();

  // 7 — the share link works signed-out, and rotating it kills the old one.
  const first = await page.request.post(`/api/v1/events/${EVENT}/day-of/links`, {
    data: { kind: "green_room", name: "Green room" },
  });
  const firstUrl = new URL((await first.json()).url, baseURL).toString();
  const crew = await openLink(browser, firstUrl);
  await expect(crew.page.locator("[data-green-room]")).toBeVisible();
  await expect(crew.page.locator(".gr-mark")).toHaveCount(0);
  await crew.page.screenshot({ path: "artifacts/mrq-285/07-share-link-390.png", fullPage: true });
  const rotated = await page.request.post(`/api/v1/events/${EVENT}/day-of/links`, {
    data: { kind: "green_room", name: "Green room" },
  });
  const rotatedUrl = new URL((await rotated.json()).url, baseURL).toString();
  expect(rotatedUrl).not.toBe(firstUrl);
  expect((await crew.page.goto(firstUrl))?.status()).toBe(404);
  expect((await crew.page.goto(rotatedUrl))?.status()).toBe(200);
  await crew.context.close();
});
