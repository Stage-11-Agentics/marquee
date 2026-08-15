import { expect, test } from "@playwright/test";

test.describe("MRQ-240 public-form recovery focus", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("AC-155 · a client validation refusal focuses the first invalid field at 375px", async ({ page }) => {
    await page.goto("/f/cfp");
    await expect(page.locator("[data-public-form]")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(375);

    await page.getByRole("button", { name: "Submit abstract" }).click();

    await expect(page.locator("#public-title")).toBeFocused();
    await expect(page.locator('[data-field-key="title"] [role="alert"]')).toContainText("Add an answer");
  });

  test("AC-156 · a server 422 focuses its first offending field at 375px", async ({ page }) => {
    await page.route("**/api/v1/public/uploads/sign", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ attachmentId: "e2e-mrq-240-headshot", completionToken: "e2e-mrq-240-token", putUrl: "/e2e-mrq-240-upload", requiredHeaders: {} }),
      });
    });
    await page.route("**/e2e-mrq-240-upload", async (route) => { await route.fulfill({ status: 200 }); });
    await page.route("**/api/v1/public/uploads/e2e-mrq-240-headshot/complete", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: "/media/e2e-mrq-240-headshot" }) });
    });
    await page.route("**/api/v1/public/forms/cfp/submissions", async (route) => {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        headers: { "X-Request-Id": "e2e-mrq-240" },
        body: JSON.stringify({
          error: {
            code: "unprocessable",
            message: "Add the requested details, then choose Submit again.",
            field: "speaker_name",
            details: { issues: [{ fieldKey: "speaker_name", message: "Use the speaker name." }] },
          },
          request_id: "e2e-mrq-240",
        }),
      });
    });

    await page.goto("/f/cfp");
    await page.locator("#public-title").fill("A useful session title");
    await page.locator("#public-abstract").fill("This abstract is long enough to satisfy the conference validation rules for the browser path.");
    await page.locator("#public-audience_outcome").fill("Attendees leave with one concrete practice they can use.");
    await page.locator("#public-format").selectOption({ index: 1 });
    await page.locator('[data-field-key="tracks"] input[type="checkbox"]').first().check();
    await page.locator("#public-speaker_name").fill("Avery Example");
    await page.locator("#public-speaker_email").fill("avery-mrq-240@example.com");
    await page.locator("#public-speaker_role").fill("Engineer");
    await page.locator("#public-speaker_company").fill("Example Company");
    await page.locator("#public-biography").fill("A concise biography with enough detail for the conference team.");
    await page.locator("#public-vendor_content").selectOption("No");
    await page.locator("#public-headshot").setInputFiles({ name: "headshot.png", mimeType: "image/png", buffer: Buffer.from("not-a-real-image") });
    await expect(page.locator('[data-field-key="headshot"]')).toContainText("Saved file: headshot.png");

    await page.getByRole("button", { name: "Submit abstract" }).click();

    await expect(page.locator("#public-speaker_name")).toBeFocused();
    await expect(page.locator('[data-field-key="speaker_name"] [role="alert"]')).toContainText("Use the speaker name");
  });
});
