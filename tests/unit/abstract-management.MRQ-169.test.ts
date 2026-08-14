/**
 * MRQ-169 — the surfaces that made the model visible.
 *
 * The model change is pinned by the integration suite; this file pins what the
 * two humans in the loop actually see: a coverage report where the click used
 * to fail silently, a refusal inside the dialog that caused it, a recorded
 * review that can be reopened and corrected, pools that can be built and
 * trimmed, and co-presenters named rather than counted.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { expect, test } from "vitest";

import { completedItemForRevision, reviewStateForRevision, reviewerRevisionFor, reviewerRevisionId, reviewerRevisionPath } from "../../src/ui/review/reviewer-revision";
import { ReviewerPage, ReviewerRevisionAction, type QueueEnvelope } from "../../src/ui/review/ReviewerPage";

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const reviewerPage = source("../../src/ui/review/ReviewerPage.tsx");
const evaluationPage = source("../../src/ui/evaluation/EvaluationPage.tsx");
const evaluationStyles = source("../../src/ui/evaluation/evaluation.css");
const submissionsPage = source("../../src/ui/submissions/SubmissionsPage.tsx");
const portalPage = source("../../src/ui/portal/PortalPage.tsx");

const revisionQueue: QueueEnvelope = {
  completed: [{
    abstract: "A completed submission",
    format: "Workshop",
    id: "submission-target",
    position: 1,
    queue_id: "submission-target",
    title: "Completed target",
    tracks: [{ color: "#0d9488", id: "track-agents", is_primary: 1, name: "Agents" }],
    review: {
      abstained: false,
      actor_id: "reviewer-target",
      comment: "Keep the concrete example.",
      created_at: 1_000,
      criteria_scores: { fit: 5, audience: "operators" },
      decision_proposal: null,
      recommendation: "maybe",
      score: 4,
      updated_at: 2_000,
    },
  }],
  counts: { reviewed: 1, total: 2, waiting: 1 },
  current_id: "submission-unreviewed",
  data: [{
    abstract: "An unreviewed submission",
    format: "Talk",
    id: "submission-unreviewed",
    position: 1,
    queue_id: "submission-unreviewed",
    title: "Unreviewed item",
    tracks: [{ color: "#0d9488", id: "track-agents", is_primary: 1, name: "Agents" }],
  }],
  plan: { id: "plan-review", name: "2026 Program review" },
  person: { bio: null, company: null, email: "reviewer@example.com", headshot_attachment_id: null, id: "reviewer-target", name: "Reviewer", social_links: [], title: null, updated_at: 1_000 },
  round: {
    anonymized: true,
    closes_at: null,
    criteria: [
      { id: "fit", kind: "numeric", name: "Fit", options: null, position: 0, scale_max: 5, scale_min: 1, weight_pct: 50 },
      { id: "audience", kind: "select", name: "Audience", options: ["operators", "developers"], position: 1, scale_max: null, scale_min: null, weight_pct: 0 },
    ],
    id: "round-review",
    mode: "scorecard",
    name: "Initial review",
    position: 0,
  },
  scopes: [{ color: "#0d9488", id: "track-agents", name: "Agents" }],
};

test("CONTRACT · MRQ-169 · distribution answers in numbers, and refuses inside its own dialog", () => {
  expect(evaluationPage).toContain("max_per_reviewer");
  expect(evaluationPage).toContain("Per-reviewer limit (optional)");
  expect(evaluationPage).toContain("coverage-report");
  expect(evaluationPage).toContain("new review");
  expect(evaluationPage).toContain("fully covered");
  expect(evaluationPage).toContain("no eligible reviewer");
  expect(evaluationPage).toContain("The per-reviewer limit stopped some abstracts short.");
  // The dialog stays open on success — the report is the answer to the click.
  expect(evaluationPage).toContain("setCoverage(report)");
  // Every dialog that can refuse renders the refusal in reserved space.
  expect(evaluationPage).toContain("setDialogError");
  expect((evaluationPage.match(/class="eval-dialog-error"/g) ?? []).length).toBeGreaterThanOrEqual(3);
  expect(evaluationStyles).toMatch(/\.eval-dialog-error \{[^}]*min-height/);
  // The outcome slot is a fixed box measured live in the browser: the report and
  // the refusal both land without moving the footer buttons (MRQ-169 validation).
  expect(evaluationStyles).toMatch(/\.distribution-outcome \{[^}]*height: 186px/);
});

test("CONTRACT · MRQ-169 · pools can be read, created, and trimmed, and an invitation names its pool", () => {
  expect(evaluationPage).toContain("removePoolMember");
  expect(evaluationPage).toContain("Create pool");
  expect(evaluationPage).toContain("Manage pools");
  expect(evaluationPage).toContain("existing assignment");
  expect(evaluationPage).toContain('aria-label="Reviewer pool"');
  expect(evaluationPage).toContain('aria-label="Agent evaluator pool"');
  // The invite dialog targets the selected pool rather than whichever committee
  // happened to sort first.
  expect(evaluationPage).toContain("committees/${invitePool.id}/invites");
  // The default is the round's own pool; any other pool is one select away.
  expect(evaluationPage).toContain("const defaultPoolId = plan?.rounds[0]?.committee_id");
});

test("CONTRACT · MRQ-169 · the round header can chase everyone who is behind", () => {
  expect(evaluationPage).toContain("remindEveryoneBehind");
  expect(evaluationPage).toContain("Remind all ${behind.length} behind");
  expect(evaluationPage).toContain("already reminded today");
});

test("CONTRACT · MRQ-169 · a recorded review reopens into the review layout and can be corrected", () => {
  expect(reviewerPage).toContain("openRevision");
  expect(reviewerPage).toContain("saving updates your review");
  expect(reviewerPage).toContain("Update review");
  expect(reviewerPage).toContain("Back to queue");
  // MRQ-171 moves the completed list to home, where its row opens the full
  // submission modal first. The modal deep-links the exact completed item back
  // into the queue, where the recorded values re-enter the ordinary controls.
  // The reader who opened the full submission to see their record gets it
  // first, above the abstract and the four sections that used to bury it.
  expect(reviewerPage.indexOf("Your saved review")).toBeLessThan(reviewerPage.indexOf("<h3>Full abstract</h3>"));

  const completed = [
    { id: "submission-other", review: { abstained: false, comment: "Other", criteria_scores: null, recommendation: "deny" as const, score: 2 } },
    { id: "submission-target", review: { abstained: false, comment: "Keep the concrete example.", criteria_scores: { fit: 5, audience: "operators" }, recommendation: "maybe" as const, score: 4 } },
    { id: "submission-unreviewed", review: null },
  ];
  const target = completedItemForRevision(completed, "submission-target");
  expect(target).toBe(completed[1]);
  expect(reviewStateForRevision(target!)).toEqual({
    abstained: false,
    comment: "Keep the concrete example.",
    criteria: { fit: 5, audience: "operators" },
    recommendation: "maybe",
    score: 4,
  });
});

test("CONTRACT · MRQ-171 · revision helpers only resolve a review in the returned completed set", () => {
  expect(reviewerRevisionPath("sub_00417")).toBe("/reviewer/queue?revise=sub_00417");
  const encoded = reviewerRevisionPath("a& reviewer note");
  const encodedUrl = new URL(encoded, "https://marquee.test");
  expect(encodedUrl.pathname).toBe("/reviewer/queue");
  expect(encodedUrl.searchParams.get("revise")).toBe("a& reviewer note");

  expect(reviewerRevisionId("?revise=sub_00417")).toBe("sub_00417");
  expect(reviewerRevisionId("")).toBeNull();
  expect(reviewerRevisionId("?revise=")).toBeNull();

  const completed = [
    { id: "submission-target", review: { abstained: false, comment: "Recorded", criteria_scores: null, recommendation: "maybe" as const, score: 4 } },
    { id: "submission-unreviewed", review: null },
  ];
  expect(completedItemForRevision(completed, "submission-target")).toBe(completed[0]);
  expect(completedItemForRevision(completed, "submission-missing")).toBeNull();
  expect(completedItemForRevision(completed, "submission-unreviewed")).toBeNull();
  expect(completedItemForRevision(completed, reviewerRevisionId("?revise=someone-else"))).toBeNull();
  const preserved = reviewerRevisionFor("", completed, "submission-target");
  expect(preserved?.item).toBe(completed[0]);
  expect(preserved?.state).toEqual(reviewStateForRevision(completed[0]));
  expect(reviewerRevisionFor("?revise=someone-else", completed, "submission-target")).toBeNull();
});

test("CONTRACT · MRQ-171 · a revision deep link is present on first render and preserves the recorded scorecard", () => {
  const homeControl = renderToString(h(ReviewerRevisionAction, {
    isHome: true,
    onRevision: () => undefined,
    submissionId: "submission-target",
  }));
  expect(homeControl).toContain('href="/reviewer/queue?revise=submission-target"');
  expect(homeControl).toContain("Revise this review");

  const revised = renderToString(h(ReviewerPage, {
    eventId: "event-review",
    initialQueue: revisionQueue,
    locationSearch: "?revise=submission-target",
  }));
  expect(revised).toContain('data-queue-id="submission-target"');
  expect(revised).toContain('aria-pressed="true"');
  expect(revised).toContain("Maybe");
  expect(revised).toContain(">4<");
  expect(revised).toContain(">5<");
  expect(revised).toContain("operators");
  expect(revised).toContain("Keep the concrete example.");
  expect(revised).toContain("Update review");
  expect(revised).not.toContain("Save recommendation &amp; next");
  expect(revised).toContain("Recorded");

  const normal = renderToString(h(ReviewerPage, { eventId: "event-review", initialQueue: revisionQueue, locationSearch: "" }));
  expect(normal).toContain('data-queue-id="submission-unreviewed"');
  expect(normal).toContain("Save recommendation &amp; next");
  expect(normal).not.toContain("Update review");

  const fractionalRevision = renderToString(h(ReviewerPage, {
    eventId: "event-review",
    initialQueue: {
      ...revisionQueue,
      completed: revisionQueue.completed?.map((item) => item.id === "submission-target" && item.review
        ? { ...item, review: { ...item.review, criteria_scores: { fit: 4.5, audience: "operators" }, score: 4.5 } }
        : item),
    },
    locationSearch: "?revise=submission-target",
  }));
  expect(fractionalRevision).toContain('aria-pressed="true">4.5</button>');

  const outOfRangeRevision = renderToString(h(ReviewerPage, {
    eventId: "event-review",
    initialQueue: {
      ...revisionQueue,
      completed: revisionQueue.completed?.map((item) => item.id === "submission-target" && item.review
        ? { ...item, review: { ...item.review, criteria_scores: { fit: 25, audience: "operators" }, score: 7 } }
        : item),
    },
    locationSearch: "?revise=submission-target",
  }));
  expect(outOfRangeRevision).toContain('aria-pressed="true">7</button>');
  expect(outOfRangeRevision).toContain('aria-pressed="true">25</button>');
  expect(outOfRangeRevision).toContain("Recorded value 7 is outside the current scale");
  expect(outOfRangeRevision).toContain("Recorded value 25 is outside the current scale");

  const nonFiniteRevision = renderToString(h(ReviewerPage, {
    eventId: "event-review",
    initialQueue: {
      ...revisionQueue,
      completed: revisionQueue.completed?.map((item) => item.id === "submission-target" && item.review
        ? { ...item, review: { ...item.review, criteria_scores: { fit: Number.NaN, audience: "operators" }, score: Number.NaN } }
        : item),
    },
    locationSearch: "?revise=submission-target",
  }));
  expect(nonFiniteRevision).toContain("Recorded value is not a finite number");
});

test("CONTRACT · reviewer round close uses the configured calendar day", () => {
  const home = renderToString(h(ReviewerPage, {
    eventId: "event-review",
    initialQueue: {
      ...revisionQueue,
      round: { ...revisionQueue.round, closes_at: Date.UTC(2026, 9, 15) },
    },
    mode: "home",
  }));
  expect(home).toContain("Closes Oct 15, 2026");
});

test("CONTRACT · MRQ-169 · co-presenters are named on the results table and in the speaker portal", () => {
  expect(submissionsPage).toContain("participationRoleLabel(speaker.role)");
  expect(portalPage).toContain("portal-copresenters");
  expect(portalPage).toContain("On this session with you");
  expect(portalPage).toContain("co_presenters");
});
