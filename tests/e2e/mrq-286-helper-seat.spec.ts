import { expect, test } from "@playwright/test";

const EVENT_ID = process.env.DRIVE_MRQ286_EVENT_ID ?? "evt_aie-ny-2026";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");

test.describe.configure({ timeout: 180_000 });

/**
 * MRQ-286's browser drive is opt-in because it creates a real helper seat in
 * the configured demo database. It follows the same door the operator sees:
 * speaker portal → on-screen helper link → helper portal → organizer chase
 * drawer, then closes the seat and proves the old session no longer opens it.
 */
if (process.env.DRIVE_MRQ286_HELPER_SEAT) {
  test("CONTRACT · MRQ-286 speaker delegates logistics to a scoped helper", async ({ browser }) => {
    const baseURL = process.env.MARQUEE_E2E_URL;
    if (!baseURL) throw new Error("MARQUEE_E2E_URL is required for the MRQ-286 browser drive");

    const helperName = `Jordan Helper ${Date.now()}`;
    const helperEmail = `mrq286-${Date.now()}@example.com`;
    const speakerContext = await browser.newContext({ baseURL });
    const helperContext = await browser.newContext({ baseURL });
    const organizerContext = await browser.newContext({ baseURL });
    try {
      const speakerLogin = await speakerContext.request.post("/api/v1/auth/demo", { data: { role: "speaker" } });
      expect(speakerLogin.ok()).toBe(true);
      const speaker = await speakerContext.newPage();
      await speaker.goto(`/portal?eventId=${encodeURIComponent(EVENT_ID)}`);
      await expect(speaker.getByRole("heading", { name: "Your helpers" })).toBeVisible();
      await speaker.locator("#helper-name").fill(helperName);
      await speaker.locator("#helper-email").fill(helperEmail);
      await speaker.getByRole("button", { name: "Invite helper" }).click();
      const helperLink = speaker.getByRole("link", { name: "Open helper portal link" });
      await expect(helperLink).toBeVisible();
      const link = await helperLink.getAttribute("href");
      expect(link).toContain("/api/v1/auth/exchange?token=");

      const helper = await helperContext.newPage();
      await helper.goto(link as string);
      await expect(helper.getByRole("heading", { name: "You help Aarush Selvan" })).toBeVisible();
      await expect(helper.getByRole("heading", { name: "Work for Aarush Selvan" })).toBeVisible();
      const helperText = await helper.locator("body").innerText();
      expect(helperText).not.toContain("You’re doing research all the time");
      expect(helperText).not.toContain("Prior to kicking off Deep Research");

      const fileTask = helper.locator("article.portal-task-row").filter({ hasText: "Presentation Upload" });
      await fileTask.getByRole("button", { name: "Finish now — Presentation Upload" }).click();
      await fileTask.locator('input[type="file"]').setInputFiles({ name: "jordan-deck.pdf", mimeType: "application/pdf", buffer: PDF });
      await fileTask.getByRole("button", { name: "Upload and complete" }).click();
      await expect(fileTask).toContainText("Complete", { timeout: 60_000 });
      await expect(fileTask).toContainText(helperName);

      const acknowledgeTask = helper.locator("article.portal-task-row").filter({ hasText: "Finalize bio & photos" });
      await acknowledgeTask.getByRole("button", { name: "Finish now — Finalize bio & photos" }).click();
      await acknowledgeTask.getByRole("checkbox", { name: "I have read and acknowledge this task." }).check();
      await acknowledgeTask.getByRole("button", { name: "Acknowledge" }).click();
      await expect(acknowledgeTask).toContainText("Complete");

      const organizerLogin = await organizerContext.request.post("/api/v1/auth/demo", { data: { role: "organizer" } });
      expect(organizerLogin.ok()).toBe(true);
      const organizer = await organizerContext.newPage();
      await organizer.goto(`/onboarding?eventId=${encodeURIComponent(EVENT_ID)}`);
      const speakerRow = organizer.locator("button.onboarding-speaker-link").filter({ hasText: "Aarush Selvan" }).first();
      await expect(speakerRow).toBeVisible({ timeout: 30_000 });
      await speakerRow.click();
      const drawer = organizer.locator('[role="dialog"]');
      await expect(drawer).toContainText("Helpers");
      await expect(drawer).toContainText(helperName);
      await expect(drawer).toContainText(helperEmail);

      const helperItem = speaker.locator(".portal-helper-list li").filter({ hasText: helperName });
      await helperItem.getByRole("button", { name: "Remove" }).click();
      await expect(helperItem).toHaveCount(0);
      await helper.reload();
      await expect(helper.getByText("You have no speaker record at this conference.")).toBeVisible({ timeout: 30_000 });
    } finally {
      await Promise.all([speakerContext.close(), helperContext.close(), organizerContext.close()]);
    }
  });
}
