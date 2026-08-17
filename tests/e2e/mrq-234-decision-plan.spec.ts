import { expect, test, type Page } from "@playwright/test";

const EVENT_ID = "evt-mrq234-e2e";
const GOOD_ID = "sub-mrq234-good";
const SKIPPED_ID = "sub-mrq234-skipped";

const event = {
  id: EVENT_ID,
  name: "MRQ-234 Conference",
  slug: "mrq-234",
  status: "live",
  demo_mode: 1,
  starts_on: "2026-10-01",
  ends_on: "2026-10-02",
  timezone: "UTC",
  venue: null,
  role: "program_lead",
  submission_count: 2,
  past: false,
};

const track = { id: "track-mrq234", name: "Program", color: "#3B82F6", is_primary: true };

const listItem = (id: string, title: string, email: string | null) => ({
  id,
  kind: "abstract",
  title,
  status: "in_review",
  format_id: null,
  format: null,
  speakers: [{ id: `person-${id}`, name: "Avery Example", company: "Example Co", role: "speaker", confirmation_status: "confirmed" }],
  tracks: [track],
  score: 4.5,
  review_count: 2,
  score_is_weighted: true,
  agent_reviews: [],
  submitted_at: 1,
  last_saved_at: 1,
  updated_at: 1,
  origin: "public",
  missing_fields: [],
  submitter: email ? { id: `person-${id}`, name: "Avery Example", email } : null,
  slot: null,
  notified: null,
});

const plan = {
  action: "accept",
  feedback_md: null,
  mail_mode: "rendered",
  template: { key: "acceptance", subject: "You are accepted", body_md: "Hello {{speaker.first_name}}", enabled: true },
  demo_suppressed: 0,
  rows: [
    { disposition: "will_send", count: 1, records: [{ id: GOOD_ID, title: "A good session", reason: "The acceptance email will be queued.", demo_suppressed: false }] },
    { disposition: "already_notified", count: 0, records: [] },
    { disposition: "no_valid_address", count: 1, records: [{ id: SKIPPED_ID, title: "Needs an address", reason: "The speaker has no valid email address.", demo_suppressed: false }] },
    { disposition: "cannot_move", count: 0, records: [] },
  ],
  recipient_preview: {
    to_email: "avery@example.test",
    subject: "You are accepted",
    text: "Hello Avery",
    html: "<p>Hello Avery</p><p> A useful follow-up for the speaker.</p>",
  },
  plan_fingerprint: "a".repeat(64),
  etag: `"${"a".repeat(64)}:0"`,
  queue_revision: 1,
  selected: 2,
  zero_effect: null,
};

async function installDecisionPlanApi(page: Page): Promise<void> {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/v1/auth/me") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          kind: "session",
          person_name: "Program Lead",
          person_email: "lead@example.test",
          org_name: "Example Org",
          demo_event_id: EVENT_ID,
          demo_event_name: event.name,
          memberships: [{ event_id: EVENT_ID, role: "program_lead" }],
        }),
      });
      return;
    }
    if (request.method() === "GET" && url.pathname === "/api/v1/events") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [event] }) });
      return;
    }
    if (request.method() === "GET" && url.pathname === `/api/v1/events/${EVENT_ID}/views`) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [{ id: "all-submissions", name: "All submissions", built_in: true, config: { q: "", filters: {}, sort: "newest", columns: ["title", "type", "status"] }, count: 2, created_at: null, updated_at: null }] }),
      });
      return;
    }
    if (request.method() === "GET" && url.pathname === `/api/v1/events/${EVENT_ID}/plans`) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) });
      return;
    }
    if (request.method() === "GET" && url.pathname === `/api/v1/events/${EVENT_ID}/submissions`) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [listItem(GOOD_ID, "A good session", "avery@example.test"), listItem(SKIPPED_ID, "Needs an address", null)], page: 1, per_page: 50, total: 2, total_pages: 1, published_count: 0 }),
      });
      return;
    }
    if (request.method() === "POST" && url.pathname === `/api/v1/events/${EVENT_ID}/submissions/decision-plan`) {
      const body = request.postDataJSON() as { feedback_md?: string } | null;
      const feedback = body?.feedback_md ?? null;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...plan, feedback_md: feedback, recipient_preview: { ...plan.recipient_preview, html: feedback ? `<p>Hello Avery</p><p>${feedback}</p>` : plan.recipient_preview.html } }),
      });
      return;
    }
    if (request.method() === "POST" && url.pathname === `/api/v1/events/${EVENT_ID}/submissions/bulk`) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          selected: 2,
          succeeded: 1,
          failed: 1,
          state: "completed_with_failures",
          outbox_enqueued: 1,
          results: [
            { id: GOOD_ID, outcome: "succeeded", resulting_status: "accepted" },
            { id: SKIPPED_ID, outcome: "failed", resulting_status: null, error: "The speaker has no valid email address." },
          ],
        }),
      });
      return;
    }
    await route.continue();
  });
}

test("AC-380 · MRQ-234 · the wave decision panel keeps its geometry, preview, feedback echo, and named skipped result", async ({ page }) => {
  await installDecisionPlanApi(page);
  await page.goto("/submissions");

  await expect(page.locator(".submissions-page")).toBeVisible();
  await page.getByRole("checkbox", { name: `Select ${GOOD_ID}` }).check();
  await page.getByRole("checkbox", { name: `Select ${SKIPPED_ID}` }).check();
  await page.getByRole("button", { name: "Accept", exact: true }).click();

  const panel = page.locator(".decision-plan-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Wave decision", { exact: true })).toBeVisible();
  await expect(panel.locator(".decision-plan-row")).toHaveCount(4);
  await expect(panel.getByText("Preview · rendered for avery@example.test", { exact: true })).toBeVisible();
  await expect(panel.locator(".decision-plan-preview-body")).toContainText("Hello Avery");

  await panel.getByLabel("Feedback for the speakers (optional)").fill("A useful follow-up for the speaker.");
  await expect(panel.locator(".decision-plan-feedback-echo")).toContainText("Feedback: A useful follow-up for the speaker.");
  await panel.getByRole("button", { name: /Accept and notify 1/ }).click();

  const result = page.locator(".decision-plan-result[role=dialog]");
  await expect(result).toBeVisible();
  await expect(result).toContainText("1 accepted · 1 could not move");
  await expect(result).toContainText("Needs an address");
  await expect(result).toContainText("The speaker has no valid email address");
});
