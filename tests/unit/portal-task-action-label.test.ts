import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, test } from "vitest";

import { TaskRow, type PortalTask } from "../../src/ui/portal/task-machinery";

/**
 * The row action button is the one control on the portal that tells a speaker
 * there is work to do here. It was labelled `Complete` — the same word the
 * state chip on a finished row carries — so a filled primary button read as a
 * badge announcing the task was already done (Atin, 2026-08-15). `Complete` is
 * the status; the button says what pressing it leads you to do.
 *
 * This is locked because the correction lives only in the build. Both
 * prototypes still render `Complete`/`Update`, DESIGN.md makes the prototype
 * binding, and MRQ-214 builds the sponsor portal from one of them — so without
 * a test the ruling reverts silently on a green gate. SPEC.md § 5.6 carries
 * the acknowledged-divergence marker that makes the build legal.
 */

function task(overrides: Partial<PortalTask> = {}): PortalTask {
  return {
    id: "task-action-label",
    submission_id: "submission-action-label",
    submission_title: "Going deep on Gemini Deep Research",
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

function markup(currentTask: PortalTask): string {
  return renderToString(h(TaskRow, {
    task: currentTask,
    renderSurface: () => h("div", null, "surface"),
  }));
}

describe("portal task row action label", () => {
  test("CONTRACT · an open task's action is an instruction, never the word Complete", () => {
    const rendered = markup(task());

    expect(rendered).toContain(">Finish now</button>");
    // The status chip still says Complete for finished rows, so the word must
    // never also be a button: that collision is the whole defect.
    expect(rendered).not.toContain(">Complete</button>");
    expect(rendered).not.toContain(">Update</button>");
  });

  test("CONTRACT · an overdue task reads the same instruction, not a status", () => {
    const rendered = markup(task({ overdue: true }));

    expect(rendered).toContain(">Finish now</button>");
    expect(rendered).toContain("Overdue · action needed");
    expect(rendered).not.toContain(">Complete</button>");
  });

  test("CONTRACT · a done task keeps Complete as its status and View as its action", () => {
    const rendered = markup(task({ status: "done", completed_at: 2 }));

    expect(rendered).toContain(">View</button>");
    expect(rendered).toContain("Complete");
    expect(rendered).not.toContain(">Complete</button>");
  });

  test("CONTRACT · the accessible name carries the task title so repeated labels stay distinguishable", () => {
    const rendered = markup(task());

    expect(rendered).toContain('aria-label="Finish now — Finalize talk description"');
  });
});
