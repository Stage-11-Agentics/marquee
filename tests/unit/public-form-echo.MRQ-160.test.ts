/**
 * A speaker filling the call for speakers chose a headshot, kept typing while
 * it uploaded, and pressed Submit to find the Biography box empty. Nothing was
 * lost server-side — validation caught it — but the text they wrote was gone.
 *
 * The cause was the draft round-trip, not the upload: every write adopted the
 * server's echo of what it had sent, so any answer written while the request
 * was in flight was overwritten by a snapshot that predated it. The upload
 * merely made that window seconds wide instead of milliseconds.
 *
 * Each test below fails against the old `setAnswers(payload.answers)`.
 */

import { describe, expect, test } from "vitest";

import { reconcileEchoedAnswers } from "../../src/ui/public/form/echo";

describe("public form · adopting a draft echo", () => {
  test("CONTRACT · keeps an answer written while the draft request was in flight", () => {
    const sent = { title: "Taming 40-Minute CI" };
    const echoed = { title: "Taming 40-Minute CI" };
    const current = { title: "Taming 40-Minute CI", biography: "Priya builds release infrastructure." };

    const result = reconcileEchoedAnswers(sent, echoed, current);

    expect(result.answers.biography).toBe("Priya builds release infrastructure.");
    expect(result.edited).toBe(true);
  });

  test("CONTRACT · keeps the newer text when an answer changed mid-flight", () => {
    const sent = { biography: "Priya builds" };
    const echoed = { biography: "Priya builds" };
    const current = { biography: "Priya builds release infrastructure at scale." };

    const result = reconcileEchoedAnswers(sent, echoed, current);

    expect(result.answers.biography).toBe("Priya builds release infrastructure at scale.");
    expect(result.edited).toBe(true);
  });

  test("CONTRACT · honours an answer the person cleared mid-flight instead of restoring it", () => {
    const sent = { biography: "a first draft" };
    const echoed = { biography: "a first draft" };
    const current = {};

    const result = reconcileEchoedAnswers(sent, echoed, current);

    expect("biography" in result.answers).toBe(false);
    expect(result.edited).toBe(true);
  });

  test("CONTRACT · adopts the server's copy of every answer the person left alone", () => {
    // The server normalises — a trimmed address, a dropped answer for a field
    // the conditional logic hid. Untouched keys are still its call to make.
    const sent = { speaker_email: " priya@example.test ", vendor_detail: "n/a" };
    const echoed = { speaker_email: "priya@example.test" };
    const current = { speaker_email: " priya@example.test ", vendor_detail: "n/a" };

    const result = reconcileEchoedAnswers(sent, echoed, current);

    expect(result.answers.speaker_email).toBe("priya@example.test");
    expect("vendor_detail" in result.answers).toBe(false);
    expect(result.edited).toBe(false);
  });

  test("CONTRACT · compares file and multi-select answers by value, not identity", () => {
    const headshot = { attachmentId: "att_1", filename: "priya.png", contentType: "image/png", sizeBytes: 4096 };
    const sent = { headshot, tracks: ["Infra", "Evals"] };
    const echoed = { headshot, tracks: ["Infra", "Evals"] };
    // A re-render hands back structurally equal values under new references.
    const current = { headshot: { ...headshot }, tracks: ["Infra", "Evals"] };

    const result = reconcileEchoedAnswers(sent, echoed, current);

    expect(result.edited).toBe(false);
  });
});
