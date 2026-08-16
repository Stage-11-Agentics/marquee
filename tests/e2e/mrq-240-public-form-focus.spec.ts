import { expect, test, type Page } from "@playwright/test";

async function use375px(page: Page) {
  await page.setViewportSize({ width: 375, height: 812 });
}

async function installUploadRoutes(page: Page) {
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
}

async function installSubmission422(page: Page, error: Record<string, unknown>) {
  await page.route("**/api/v1/public/forms/cfp/submissions", async (route) => {
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      headers: { "X-Request-Id": "e2e-mrq-240" },
      body: JSON.stringify({ error, request_id: "e2e-mrq-240" }),
    });
  });
}

async function installCombinedLengthRule(page: Page) {
  await page.route((url, request) => url.pathname === "/api/v1/public/forms/cfp" && request.method() === "GET", async (route) => {
    const response = await route.fetch();
    const body = await response.json() as { form: { length_rules?: unknown[] } };
    body.form.length_rules = [
      ...(body.form.length_rules ?? []),
      {
        id: "e2e-mrq-246-programme",
        label: "Updated programme block",
        field_keys: ["title", "abstract"],
        max_chars: 20,
        sort_order: 0,
        disabled: false,
        missing_field_keys: [],
      },
    ];
    await route.fulfill({ response, body: JSON.stringify(body) });
  });
}

async function fillValidSubmission(page: Page) {
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
}

test.describe("CONTRACT · public-form recovery focus", () => {
  test("AC-155 · a client validation refusal focuses the first invalid field at 375px", async ({ page }) => {
    await use375px(page);
    await page.goto("/f/cfp");
    await expect(page.locator("[data-public-form]")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(375);

    await page.getByRole("button", { name: "Submit abstract" }).click();

    await expect(page.locator("#public-title")).toBeFocused();
    await expect(page.locator('[data-field-key="title"] [role="alert"]')).toContainText("Add an answer");
  });

  test("CONTRACT · MRQ-246 · the combined counter crosses its cap and focuses the first visible group field", async ({ page }) => {
    await use375px(page);
    await installUploadRoutes(page);
    await installCombinedLengthRule(page);

    await page.goto("/f/cfp");
    await expect(page.locator("[data-public-form]")).toBeVisible();
    const counter = page.locator('[data-length-rule="e2e-mrq-246-programme"]');
    await expect(counter).toContainText("0/20");

    await fillValidSubmission(page);
    await expect(counter).toContainText("over");
    await page.getByRole("button", { name: "Submit abstract" }).click();

    await expect(page.locator("#public-title")).toBeFocused();
    await expect(page.locator('[data-field-key="title"] [role="alert"]')).toContainText("Updated programme block is");
    await expect(page.locator('[data-field-key="title"] [role="alert"]')).not.toContainText("valid date");
  });

  test("AC-156 · a server 422 focuses the first offending field in document order at 375px", async ({ page }) => {
    await use375px(page);
    await installUploadRoutes(page);
    await installSubmission422(page, {
      code: "unprocessable",
      message: "Add the requested details, then choose Submit again.",
      field: "speaker_name",
      details: {
        // The server appends this participant issue after the earlier field
        // issue; the client must still focus title because it is first in the
        // rendered form.
        issues: [
          { fieldKey: "speaker_name", message: "Use the speaker name." },
          { fieldKey: "title", message: "Use the session title." },
        ],
      },
    });

    await page.goto("/f/cfp");
    await fillValidSubmission(page);
    await page.getByRole("button", { name: "Submit abstract" }).click();

    await expect(page.locator("#public-title")).toBeFocused();
    await expect(page.locator('[data-field-key="title"] [role="alert"]')).toContainText("Use the session title");
  });

  test("CONTRACT · a form-level server 422 focuses the error banner at 375px", async ({ page }) => {
    await use375px(page);
    await installUploadRoutes(page);
    await installSubmission422(page, {
      code: "unprocessable",
      message: "The conference needs one more detail before it can accept this submission.",
    });

    await page.goto("/f/cfp");
    await fillValidSubmission(page);
    await page.getByRole("button", { name: "Submit abstract" }).click();

    await expect(page.locator(".public-error")).toBeFocused();
  });

  test("CONTRACT · a server 422 for an unrendered field focuses the error banner at 375px", async ({ page }) => {
    await use375px(page);
    await installUploadRoutes(page);
    await installSubmission422(page, {
      code: "unprocessable",
      message: "The conference needs one more detail before it can accept this submission.",
      details: { issues: [{ fieldKey: "conditional_not_rendered", message: "This field is not currently shown." }] },
    });

    await page.goto("/f/cfp");
    await fillValidSubmission(page);
    await page.getByRole("button", { name: "Submit abstract" }).click();

    await expect(page.locator(".public-error")).toBeFocused();
  });
});
