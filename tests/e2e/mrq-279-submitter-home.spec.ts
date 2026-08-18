import { expect, test, type Page } from "@playwright/test";

/**
 * MRQ-279 drive — the whole submitter story in a real browser.
 *
 * Not part of `npm run e2e`'s contract set; it is the artifact-producing drive
 * for the ticket, and it needs a seeded local Worker plus a way to read the
 * outbox (the mail is queued, never sent, on a demo conference).
 */

const NAME = process.env.DRIVE_NAME ?? "Nadia Okonkwo";
const EMAIL = process.env.DRIVE_EMAIL ?? "nadia.okonkwo-279@example.com";
const STRANGER = process.env.DRIVE_STRANGER ?? "someone-else-279@example.com";

/** A real 1×1 PNG — the upload path sniffs magic bytes, so a text buffer is refused. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function fillProposal(page: Page, title: string) {
  await page.locator("#public-title").fill(title);
  await page.locator("#public-abstract").fill("This abstract is long enough to satisfy the conference validation rules for the browser path, and it describes a real session.");
  await page.locator("#public-audience_outcome").fill("Attendees leave with one concrete practice they can use on Monday morning.");
  await page.locator("#public-format").selectOption({ index: 1 });
  await page.locator('[data-field-key="tracks"] input[type="checkbox"]').first().check();
  await page.locator("#public-speaker_name").fill(NAME);
  await page.locator("#public-speaker_email").fill(EMAIL);
  await page.locator("#public-speaker_role").fill("Staff Engineer");
  await page.locator("#public-speaker_company").fill("Ravelin Labs");
  await page.locator("#public-biography").fill("A concise biography with enough detail for the conference team to work with.");
  await page.locator("#public-vendor_content").selectOption("No");
  await page.locator("#public-headshot").setInputFiles({ name: "headshot.png", mimeType: "image/png", buffer: PNG });
  await expect(page.locator('[data-field-key="headshot"]')).toContainText("Saved file: headshot.png");
}

async function submitProposal(page: Page, title: string, tag: string) {
  await page.goto("/f/cfp");
  await page.evaluate(() => window.localStorage.clear());
  await page.goto("/f/cfp");
  await fillProposal(page, title);
  await page.getByRole("button", { name: "Submit abstract" }).click();
  await expect(page.locator("[data-public-submitted]")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `artifacts/mrq-279/${tag}.png`, fullPage: true });
  console.log(`SUBMITTED ${tag}:`, (await page.locator("[data-public-submitted]").innerText()).replace(/\n/g, " · "));
}

test.describe.configure({ timeout: 300_000 });

// This is an artifact-producing, write-heavy drive. Keep it opt-in so the
// ordinary E2E suite can never submit proposals to its configured base URL.
const DRIVE_SUBMITTER_HOME = process.env.DRIVE_SUBMITTER_HOME;
if (DRIVE_SUBMITTER_HOME) test("CONTRACT · MRQ-279 two proposals, one person, one page", async ({ page }) => {

  await submitProposal(page, "Taming 40-Minute CI: Incremental Builds at Monorepo Scale", "01-submitted-first");
  await submitProposal(page, "Your AI Pair Programmer Needs a Code Review Budget", "02-submitted-second");

  // The handoff the submitter actually follows.
  await page.locator("[data-public-proposals-link]").click();
  await expect(page.locator("#proposals-form")).toBeVisible();
  await page.screenshot({ path: "artifacts/mrq-279/03-my-proposals-door.png", fullPage: true });

  // The negative, on the same page and before anything is opened: a stranger's
  // address must produce the same sentence and reveal nothing.
  await page.locator("#proposals-email").fill(STRANGER);
  await page.locator("#proposals-submit").click();
  await expect(page.locator("#proposals-status")).toContainText("If that address has proposals", { timeout: 15_000 });
  const strangerAnswer = await page.locator("#proposals-status").innerText();
  await page.screenshot({ path: "artifacts/mrq-279/04-stranger-answer.png", fullPage: true });

  // The real submitter's own request, which must be answered identically.
  await page.locator("#proposals-email").fill(EMAIL);
  await page.locator("#proposals-submit").click();
  await expect(page.locator("#proposals-status")).toContainText("If that address has proposals", { timeout: 15_000 });
  const ownerAnswer = await page.locator("#proposals-status").innerText();
  expect(ownerAnswer).toBe(strangerAnswer);
  console.log("IDENTICAL ANSWER:", ownerAnswer);
  await page.screenshot({ path: "artifacts/mrq-279/05-owner-answer.png", fullPage: true });

});

/**
 * The second half, run after the outbox has been read for the link the first
 * half caused to be queued. A demo conference queues mail and never sends it,
 * so opening it is a two-step drive by construction.
 */
// Registered only when the link is supplied. A demo conference queues its mail
// and never sends it, so the drive is two steps by construction: the first test
// causes the mail, the runner reads it out of the outbox, and this half opens it.
const DRIVE_LINK = process.env.DRIVE_LINK;
if (DRIVE_LINK) test("CONTRACT · MRQ-279 the emailed link opens the submitter's own home", async ({ page }) => {
  await page.goto(DRIVE_LINK);
  await expect(page.locator('[data-portal-seat="submitter"]')).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "artifacts/mrq-279/06-submitter-home.png", fullPage: true });
  console.log("SUBMITTER HOME:\n", await page.locator(".portal-main").innerText());

  await expect(page.locator("[data-submission-id]")).toHaveCount(2);
  await expect(page.locator('[data-portal-seat="submitter"]')).toContainText("Your 2 proposals");
});
