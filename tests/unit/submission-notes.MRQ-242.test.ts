// @vitest-environment happy-dom

import { h, render } from "preact";
import { act } from "preact/test-utils";
import { renderToString } from "preact-render-to-string";
import { afterEach, describe, expect, test } from "vitest";

import {
  DecisionEmailRecovery,
  EvaluationEmptyState,
  isMissingDecisionEmail,
  SubmissionNotesBody,
  SubmissionNotesCardBody,
  type SubmissionNote,
} from "../../src/ui/submissions/SubmissionRecordPage";
import { MarqueeApiError } from "../../src/ui/shell/api-client";

const dom = globalThis.document as any;
let root: any;

afterEach(() => {
  if (root) render(null, root);
  root?.remove();
  root = null;
  document.body.innerHTML = "";
});

function mount(element: any): any {
  root = dom.createElement("div");
  dom.body.append(root);
  act(() => render(element, root));
  return root;
}

const note: SubmissionNote = {
  id: "note_mrq242_1",
  submission_id: "submission_mrq242_1",
  body: "Keep the speaker's deployment constraint in view.",
  author_person_id: "person_organizer",
  author_name: "Ada Organizer",
  created_at: 1_735_000_000_000,
};

describe("MRQ-242 submission notes and recovery copy", () => {
  test("the notes card renders loading, empty, and populated states without losing their content", () => {
    const loading = renderToString(h(SubmissionNotesBody, { state: "loading", notes: [], error: "" }));
    const empty = renderToString(h(SubmissionNotesBody, { state: "ready", notes: [], error: "" }));
    const populated = renderToString(h(SubmissionNotesBody, { state: "ready", notes: [note], error: "" }));

    expect(loading).toContain("Loading internal notes");
    expect(empty).toContain("No internal notes yet");
    expect(populated).toContain("Ada Organizer");
    expect(populated).toContain(note.body);
  });

  test("the evaluation empty state renders its setup CTA and navigates to evaluation", () => {
    const destinations: string[] = [];
    const mounted = mount(h(EvaluationEmptyState, { navigate: (target: string) => destinations.push(target) }));
    const emptyState = mounted.querySelector(".record-evaluation-empty");
    const button = emptyState?.querySelector("button") as any;

    expect(emptyState?.textContent).toContain("No evaluation rounds configured.");
    expect(button).not.toBeNull();
    expect(button?.textContent).toBe("Set up evaluation");

    act(() => button.click());

    expect(destinations).toEqual(["/evaluation"]);
  });

  test("the notes card keeps its computed viewport across loading, empty, and populated states", () => {
    const mounted = mount(h(SubmissionNotesCardBody, {
      state: "loading",
      notes: [],
      error: "",
      compose: h("div", { class: "record-notes-compose" }, "Compose"),
    }));
    let baseline: Record<string, string> | undefined;

    for (const current of [
      { state: "loading" as const, notes: [] },
      { state: "ready" as const, notes: [] },
      { state: "ready" as const, notes: [note] },
    ]) {
      act(() => render(h(SubmissionNotesCardBody, {
        ...current,
        error: "",
        compose: h("div", { class: "record-notes-compose" }, "Compose"),
      }), mounted));

      const cardBody = mounted.querySelector(".record-notes-card-body") as any;
      const content = mounted.querySelector(".record-notes-content") as any;
      const cardStyle = getComputedStyle(cardBody) as any;
      const contentStyle = getComputedStyle(content) as any;
      const geometry = {
        gridTemplateRows: cardStyle.gridTemplateRows,
        contentHeight: contentStyle.height,
        contentMinHeight: contentStyle.minHeight,
        contentMaxHeight: contentStyle.maxHeight,
        contentOverflowY: contentStyle.overflowY,
      };

      expect(geometry).toEqual({
        gridTemplateRows: "220px 126px",
        contentHeight: "220px",
        contentMinHeight: "220px",
        contentMaxHeight: "220px",
        contentOverflowY: "auto",
      });
      if (baseline) expect(geometry).toEqual(baseline);
      baseline = geometry;
    }
  });

  test("a missing decision email gets a speaker-record recovery action", () => {
    const error = new MarqueeApiError({
      code: "unprocessable",
      message: "speaker has no valid email address; record was left unchanged",
      status: 422,
      route: "/api/v1/events/{eventId}/submissions/{submissionId}/decision",
    });
    const html = renderToString(h(DecisionEmailRecovery, { speakerName: "Ada Speaker", onOpen: () => undefined }));

    expect(isMissingDecisionEmail(error)).toBe(true);
    expect(isMissingDecisionEmail(new Error("speaker has no valid email address"))).toBe(false);
    expect(html).toContain("No usable email address is on file for Ada Speaker");
    expect(html).toContain("Open speaker record");
  });
});
