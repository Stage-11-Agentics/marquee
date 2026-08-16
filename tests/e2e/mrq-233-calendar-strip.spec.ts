import { expect, test, type Page } from "@playwright/test";

const eventId = process.env.MRQ_233_E2E_EVENT_ID;
const submissionId = process.env.MRQ_233_E2E_SUBMISSION_ID;
const blockedEventId = process.env.MRQ_233_E2E_BLOCKED_EVENT_ID;

async function enterOrganizer(page: Page): Promise<void> {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Enter as organizer" }).click();
}

test.describe("MRQ-233 calendar attention and explicit record resend", () => {
  test.beforeEach(() => {
    test.skip(!eventId || !submissionId, "Set MRQ_233_E2E_EVENT_ID and MRQ_233_E2E_SUBMISSION_ID for the approved operator validation run.");
  });

  test("agenda keeps the zero-debt calendar gauge and fixed send geometry", async ({ page }) => {
    await enterOrganizer(page);
    await page.goto(`/agenda-builder?event=${encodeURIComponent(eventId!)}`);

    const strip = page.locator(".agenda-attention-strip");
    await expect(strip).toBeVisible();
    await expect(strip.locator(".agenda-attention-gauge")).toHaveCount(2);
    const send = strip.locator('[data-calendar-send="true"]');
    await expect(send).toHaveCSS("width", "190px");
    await expect(send).toBeDisabled();
  });

  test("agenda modal names blocked rows instead of silently filtering them", async ({ page }) => {
    test.skip(!blockedEventId, "Set MRQ_233_E2E_BLOCKED_EVENT_ID for the approved blocked-recipient validation run.");
    await enterOrganizer(page);
    await page.goto(`/agenda-builder?event=${encodeURIComponent(blockedEventId!)}`);
    await page.locator('[data-calendar-send="true"]').click();

    const modal = page.locator('[data-calendar-modal="true"]');
    await expect(modal).toBeVisible();
    await expect(modal.locator('[data-calendar-blocked-row="true"]')).toHaveCount(1);
    await expect(modal.locator('[data-calendar-blocked-row="true"]')).toContainText(/missing email|invalid email/i);
  });

  test("dashboard keeps the calendar row in the signed three-column attention grid", async ({ page }) => {
    await enterOrganizer(page);
    await page.goto(`/dashboard?event=${encodeURIComponent(eventId!)}`);

    const attention = page.locator(".dashboard-attention");
    const items = attention.locator(".dashboard-attention-item");
    await expect(attention).toBeVisible();
    await expect(items.filter({ hasText: /unsent schedule updates/i })).toHaveCount(1);
    expect(await items.count()).toBeGreaterThanOrEqual(3);

    await page.setViewportSize({ width: 1280, height: 900 });
    const wideColumns = await attention.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
    expect(wideColumns).toBe(3);
    const rows = await items.evaluateAll((nodes) => {
      const tops = [...nodes].map((node) => Math.round(node.getBoundingClientRect().top));
      return new Set(tops).size;
    });
    if (await items.count() >= 5) expect(rows).toBe(2);

    await page.setViewportSize({ width: 640, height: 900 });
    const narrowColumns = await attention.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
    expect(narrowColumns).toBe(1);
  });

  test("scheduled submission record keeps the explicit per-session calendar resend action", async ({ page }) => {
    await enterOrganizer(page);
    await page.goto(`/submissions/${encodeURIComponent(submissionId!)}?event=${encodeURIComponent(eventId!)}`);

    const resend = page.locator('[data-calendar-record-send="true"]');
    await expect(resend).toBeVisible();
    await expect(resend).toHaveText("Send calendar invite again");
    await expect(resend).toBeEnabled();
  });
});
