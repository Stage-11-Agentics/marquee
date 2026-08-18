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

    const runId = Date.now();
    const helperName = `Jordan Portal ${runId}`;
    const helperEmail = `mrq286-portal-${runId}@example.com`;
    const recordHelperName = `Morgan SpeakerRecord ${runId}`;
    const recordHelperEmail = `mrq286-record-${runId}@example.com`;
    const onboardingHelperName = `Riley Onboarding ${runId}`;
    const onboardingHelperEmail = `mrq286-onboarding-${runId}@example.com`;
    const speakerContext = await browser.newContext({ baseURL });
    const helperContext = await browser.newContext({ baseURL });
    const organizerHelperContext = await browser.newContext({ baseURL });
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

      // The organizer's SpeakerRecord is a separate write door from the
      // speaker portal. Capture the demo invite from the real form response so
      // the helper signs in through the organizer-created seat below.
      await organizer.goto(`/roster?eventId=${encodeURIComponent(EVENT_ID)}`);
      await expect(organizer.getByRole("heading", { name: "Speakers" })).toBeVisible({ timeout: 30_000 });
      const rosterSpeaker = organizer.locator("button.speaker-link").filter({ hasText: "Aarush Selvan" }).first();
      await expect(rosterSpeaker).toBeVisible({ timeout: 30_000 });
      await rosterSpeaker.click();
      const record = organizer.locator("aside.speaker-record");
      await expect(record.getByRole("heading", { name: "Aarush Selvan" })).toBeVisible({ timeout: 30_000 });
      const recordAddResponse = organizer.waitForResponse((response) => response.request().method() === "POST" && response.url().includes(`/api/v1/events/${EVENT_ID}/speakers/`) && response.url().endsWith("/helpers"));
      const recordForm = record.locator("form.speaker-helper-form");
      await recordForm.getByLabel("Name").fill(recordHelperName);
      await recordForm.getByLabel("Email").fill(recordHelperEmail);
      await recordForm.getByRole("button", { name: "Add helper" }).click();
      const recordResponse = await recordAddResponse;
      expect(recordResponse.ok()).toBe(true);
      const recordPayload = await recordResponse.json() as { invite?: { magic_link?: string }; helper?: { helper_name: string; helper_email: string } };
      expect(recordPayload.helper).toMatchObject({ helper_name: recordHelperName, helper_email: recordHelperEmail });
      expect(recordPayload.invite?.magic_link).toContain("/api/v1/auth/exchange?token=");
      await expect(record).toContainText(recordHelperName);
      const recordHelperLink = recordPayload.invite?.magic_link;
      if (!recordHelperLink) throw new Error("demo SpeakerRecord helper invite did not return a magic link");

      // The second organizer door is the onboarding chase drawer. It must be a
      // real UI write as well, not merely a direct API assertion.
      await organizer.goto(`/onboarding?eventId=${encodeURIComponent(EVENT_ID)}`);
      const speakerRow = organizer.locator("button.onboarding-speaker-link").filter({ hasText: "Aarush Selvan" }).first();
      await expect(speakerRow).toBeVisible({ timeout: 30_000 });
      await speakerRow.click();
      const drawer = organizer.locator('[role="dialog"]');
      await expect(drawer).toContainText("Helpers");
      const onboardingAddResponse = organizer.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/helpers"));
      const onboardingForm = drawer.locator("form.onboarding-helper-form");
      await onboardingForm.getByLabel("Name").fill(onboardingHelperName);
      await onboardingForm.getByLabel("Email").fill(onboardingHelperEmail);
      await onboardingForm.getByRole("button", { name: "Add helper" }).click();
      const onboardingResponse = await onboardingAddResponse;
      expect(onboardingResponse.ok()).toBe(true);
      await expect(drawer).toContainText(onboardingHelperName);
      await expect(drawer).toContainText(onboardingHelperEmail);

      // Sign in using the seat created from SpeakerRecord, and verify the
      // helper view is scoped before the speaker revokes that same seat.
      const organizerHelper = await organizerHelperContext.newPage();
      await organizerHelper.goto(recordHelperLink);
      await expect(organizerHelper.getByRole("heading", { name: "You help Aarush Selvan" })).toBeVisible();
      await expect(organizerHelper.getByRole("heading", { name: "Work for Aarush Selvan" })).toBeVisible();
      const organizerHelperText = await organizerHelper.locator("body").innerText();
      expect(organizerHelperText).not.toContain("You’re doing research all the time");
      expect(organizerHelperText).not.toContain("Prior to kicking off Deep Research");

      // The speaker revokes the organizer-created relationship from their own
      // portal. The helper's already-open session must lose the seat too.
      await speaker.goto(`/portal?eventId=${encodeURIComponent(EVENT_ID)}`);
      const recordHelperItem = speaker.locator(".portal-helper-list li").filter({ hasText: recordHelperName });
      await expect(recordHelperItem).toBeVisible({ timeout: 30_000 });
      await recordHelperItem.getByRole("button", { name: "Remove" }).click();
      await expect(recordHelperItem).toHaveCount(0);
      await organizerHelper.reload();
      await expect(organizerHelper.getByText("You have no speaker record at this conference.")).toBeVisible({ timeout: 30_000 });

      // Clean up the two other seats created during this browser proof.
      const onboardingHelperItem = drawer.locator(".onboarding-context-row").filter({ hasText: onboardingHelperName });
      await onboardingHelperItem.getByRole("button", { name: "Remove" }).click();
      await expect(drawer).not.toContainText(onboardingHelperName);
      const portalHelperItem = speaker.locator(".portal-helper-list li").filter({ hasText: helperName });
      await portalHelperItem.getByRole("button", { name: "Remove" }).click();
      await expect(portalHelperItem).toHaveCount(0);
    } finally {
      await Promise.all([speakerContext.close(), helperContext.close(), organizerHelperContext.close(), organizerContext.close()]);
    }
  });
}
