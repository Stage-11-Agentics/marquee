import { readFileSync } from "node:fs";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, test } from "vitest";

import {
  DecisionEmailRecovery,
  isMissingDecisionEmail,
  SubmissionNotesBody,
  type SubmissionNote,
} from "../../src/ui/submissions/SubmissionRecordPage";
import { MarqueeApiError } from "../../src/ui/shell/api-client";

const recordSource = readFileSync(new URL("../../src/ui/submissions/SubmissionRecordPage.tsx", import.meta.url), "utf8");
const recordStyles = readFileSync(new URL("../../src/ui/submissions/record.css", import.meta.url), "utf8");
const note: SubmissionNote = {
  id: "note_mrq242_1",
  submission_id: "submission_mrq242_1",
  body: "Keep the speaker's deployment constraint in view.",
  author_person_id: "person_organizer",
  author_name: "Ada Organizer",
  created_at: 1_735_000_000_000,
};

describe("MRQ-242 submission notes and recovery copy", () => {
  test("the notes card gives loading, empty, and populated states the same content viewport", () => {
    const loading = renderToString(h(SubmissionNotesBody, { state: "loading", notes: [], error: "" }));
    const empty = renderToString(h(SubmissionNotesBody, { state: "ready", notes: [], error: "" }));
    const populated = renderToString(h(SubmissionNotesBody, { state: "ready", notes: [note], error: "" }));

    expect(loading).toContain("Loading internal notes");
    expect(empty).toContain("No internal notes yet");
    expect(populated).toContain("Ada Organizer");
    expect(populated).toContain(note.body);
    expect(recordStyles).toMatch(/\.record-notes-content \{[^}]*height: 220px;[^}]*max-height: 220px;[^}]*min-height: 220px/);
    expect(recordStyles).toMatch(/\.record-notes-card-body \{[^}]*grid-template-rows: 220px 126px/);
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
    expect(recordSource).toContain('onClick={() => navigate("/evaluation")}');
    expect(recordSource).toContain("Set up evaluation");
  });
});
