import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, test } from "vitest";

import { TaskSurface, type PortalPerson, type PortalSubmission, type PortalTask } from "../../src/ui/portal/PortalPage";

const person: PortalPerson = {
  id: "person-mrq-93",
  name: "Aarush Selvan",
  email: "aarush.selvan@example.com",
  title: "Researcher",
  company: "Example Labs",
  bio: "A speaker bio for the profile subject surface.",
  social_links: [],
  headshot_attachment_id: null,
  updated_at: 1,
};

const submission: PortalSubmission = {
  id: "submission-mrq-93",
  title: "Going deep on Gemini Deep Research",
  description: "A concrete abstract that belongs inside the finalize task.",
  status: "accepted",
  status_label: "Accepted",
  format: "Talk",
  wave: null,
  wave_decision_on: null,
  slot: null,
  decision_feedback: null,
  participations: [],
  talk_editable: true,
  history: [],
};

function task(overrides: Partial<PortalTask> = {}): PortalTask {
  return {
    id: "task-mrq-93",
    submission_id: submission.id,
    submission_title: submission.title,
    template_id: "tpl_finalize-talk-description",
    title: "Finalize talk description",
    kind: "acknowledge",
    description: "Confirm the title and abstract before publication.",
    due_at: 1,
    status: "open",
    completed_at: null,
    cancelled_at: null,
    cancelled_reason: null,
    overdue: false,
    payload: { kind: "acknowledge", acknowledged: false },
    ...overrides,
  };
}

function markup(currentTask: PortalTask, currentSubmission: PortalSubmission | null = submission): string {
  return renderToString(h(TaskSurface, {
    eventId: "evt_mrq93",
    task: currentTask,
    submission: currentSubmission,
    person,
    onComplete: async () => undefined,
  }));
}

describe("MRQ-93 portal subject task dispatch", () => {
  test("CONTRACT · MRQ-93 · renders the talk subject and abstract-specific confirmation", () => {
    const rendered = markup(task());

    expect(rendered).toContain(submission.title);
    expect(rendered).toContain(submission.description!);
    expect(rendered).toContain("I have reviewed this talk title and abstract.");
    expect(rendered).toContain("Confirm abstract");
  });

  test("CONTRACT · MRQ-93 · keeps a generic acknowledgement on its original surface", () => {
    const rendered = markup(task({ template_id: "tpl_announce-your-participation" }), null);

    expect(rendered).toContain("I have read and acknowledge this task.");
    expect(rendered).toContain("Acknowledge");
    expect(rendered).not.toContain("I have reviewed this talk title and abstract.");
  });

  test("CONTRACT · MRQ-93 · shows the closed talk reason without an edit affordance", () => {
    const rendered = markup(task(), { ...submission, talk_editable: false });

    expect(rendered).toContain(submission.description!);
    expect(rendered).toContain("Talk editing is closed because the conference call for proposals is closed.");
    expect(rendered).toContain(">Closed</button>");
    expect(rendered).not.toContain(">Edit talk</button>");
  });

  test("CONTRACT · MRQ-93 · renders the bio and headshot subject even without a submission", () => {
    const rendered = markup(task({
      submission_id: null,
      submission_title: null,
      template_id: "tpl_finalize-bio-and-photos",
      title: "Finalize bio & photos",
    }), null);

    expect(rendered).toContain("Speaker profile");
    expect(rendered).toContain(person.bio!);
    expect(rendered).toContain("I have reviewed my speaker bio and headshot.");
    expect(rendered).toContain("Confirm profile");
  });
});
