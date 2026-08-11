/**
 * MRQ-81 regressions. The public CFP form was not merely awkward — it was
 * dead: no Turnstile widget was ever mounted, so no token was ever minted, so
 * every gated round-trip 403'd; the one call that would have explained it
 * threw first; and even with a token the presign refused images outright.
 *
 * Each test below fails on the code as it was. A happy-path test would not
 * have: the happy path was never reachable.
 */

import { describe, expect, test } from "vitest";

import { isFieldApplicable, projectApplicableAnswers } from "../../src/lib/form-conditions";
import { policyFor, validateDeclared } from "../../src/lib/r2/policy";
import {
  removeTurnstileWidget,
  renderTurnstileWidget,
  resetTurnstileWidget,
  type TurnstileApi,
} from "../../src/ui/public/form/turnstile";

/** Cloudflare's own behaviour when the container holds no widget. */
const UNMOUNTED_TURNSTILE: TurnstileApi = {
  render: () => {
    throw new Error("[Cloudflare Turnstile] Could not render widget.");
  },
  reset: () => {
    throw new Error("[Cloudflare Turnstile] Nothing to reset found for provided container.");
  },
  remove: () => {
    throw new Error("[Cloudflare Turnstile] Cannot find Widget.");
  },
};

const HEADSHOT_FIELD = {
  id: "field_headshot",
  key: "headshot",
  label: "Headshot",
  help_text: "JPG or PNG",
  type: "file" as const,
  required: true,
  position: 0,
  config: { accept: ["image/jpeg", "image/png"], maxBytes: 5_242_880 },
  condition: null,
};

describe("CONTRACT · the Turnstile helper cannot abort the flow that calls it", () => {
  test("CONTRACT · resetTurnstileWidget swallows the throw Cloudflare raises when no widget is mounted", () => {
    expect(() => resetTurnstileWidget(UNMOUNTED_TURNSTILE, null)).not.toThrow();
    expect(resetTurnstileWidget(UNMOUNTED_TURNSTILE, null)).toBe(false);
  });

  test("CONTRACT · resetTurnstileWidget swallows the throw for a widget id that no longer exists", () => {
    expect(() => resetTurnstileWidget(UNMOUNTED_TURNSTILE, "cf-chl-widget-gone")).not.toThrow();
  });

  test("CONTRACT · resetTurnstileWidget is inert when the Turnstile script never loaded", () => {
    expect(resetTurnstileWidget(undefined, null)).toBe(false);
    expect(resetTurnstileWidget({}, "cf-chl-widget-1")).toBe(false);
  });

  test("CONTRACT · resetTurnstileWidget addresses the mounted widget by id", () => {
    const seen: Array<string | undefined> = [];
    const api: TurnstileApi = { reset: (widgetId) => { seen.push(widgetId); } };
    expect(resetTurnstileWidget(api, "cf-chl-widget-7")).toBe(true);
    expect(seen).toEqual(["cf-chl-widget-7"]);
  });

  test("CONTRACT · removeTurnstileWidget never throws when the widget is already gone", () => {
    expect(() => removeTurnstileWidget(UNMOUNTED_TURNSTILE, "cf-chl-widget-gone")).not.toThrow();
    expect(removeTurnstileWidget(UNMOUNTED_TURNSTILE, "cf-chl-widget-gone")).toBe(false);
  });
});

describe("CONTRACT · the explicit-render script mounts a widget rather than none", () => {
  test("CONTRACT · renderTurnstileWidget mounts into the container and returns the widget id", () => {
    const container = { nodeName: "DIV" } as unknown as HTMLElement;
    let options: Record<string, unknown> = {};
    const api: TurnstileApi = {
      render: (node, given) => {
        expect(node).toBe(container);
        options = given;
        return "cf-chl-widget-42";
      },
    };
    const tokens: string[] = [];
    expect(renderTurnstileWidget(api, container, { sitekey: "1x00000000000000000000AA", onToken: (t) => tokens.push(t) })).toBe("cf-chl-widget-42");
    expect(options.sitekey).toBe("1x00000000000000000000AA");

    // A solved challenge, an expiry and an error all have to reach the form:
    // an expired token left in place is the 403 the submitter cannot explain.
    (options.callback as (token: string) => void)("solved-token");
    (options["expired-callback"] as () => void)();
    (options["error-callback"] as () => void)();
    expect(tokens).toEqual(["solved-token", "", ""]);
  });

  test("CONTRACT · renderTurnstileWidget reports no widget rather than throwing before the script arrives", () => {
    const container = { nodeName: "DIV" } as unknown as HTMLElement;
    expect(renderTurnstileWidget(undefined, container, { sitekey: "site", onToken: () => {} })).toBeNull();
    expect(renderTurnstileWidget(UNMOUNTED_TURNSTILE, container, { sitekey: "site", onToken: () => {} })).toBeNull();
    expect(renderTurnstileWidget({ render: () => "id" }, null, { sitekey: "site", onToken: () => {} })).toBeNull();
  });
});

describe("CONTRACT · a completed file upload clears the field's required state", () => {
  test("CONTRACT · the attachment record a finished upload writes satisfies the required file field", () => {
    const fields = [HEADSHOT_FIELD];
    const unanswered = projectApplicableAnswers(fields, {});
    expect(unanswered.issues.map((issue) => issue.fieldKey)).toEqual(["headshot"]);

    // Exactly the value handleFile writes through setAnswer once the upload
    // completes — the single thing that clears the field, and the line the
    // pre-fix code never reached.
    const answered = projectApplicableAnswers(fields, {
      headshot: { attachmentId: "att_1", filename: "headshot.png", contentType: "image/png", sizeBytes: 22_785 },
    });
    expect(answered.issues).toEqual([]);
    expect(isFieldApplicable(HEADSHOT_FIELD, {})).toBe(true);
  });

  test("CONTRACT · an empty or absent file answer still fails the required check", () => {
    for (const value of [undefined, null, ""]) {
      const result = projectApplicableAnswers([HEADSHOT_FIELD], { headshot: value });
      expect(result.issues.map((issue) => issue.fieldKey)).toEqual(["headshot"]);
    }
  });
});

describe("CONTRACT · a public form field's own accept list governs its presign", () => {
  test("CONTRACT · an image field accepts the image it asks for", () => {
    const policy = policyFor("draft_file", { accept: ["image/jpeg", "image/png"], maxBytes: 5_242_880 });
    expect(policy).not.toBeNull();
    expect(validateDeclared(policy!, { filename: "headshot.png", contentType: "image/png", sizeBytes: 22_785 })).toMatchObject({ ok: true });
    expect(validateDeclared(policy!, { filename: "headshot.jpg", contentType: "image/jpeg", sizeBytes: 22_785 })).toMatchObject({ ok: true });
  });

  test("CONTRACT · an image field still refuses a document, and a document field still refuses an image", () => {
    const images = policyFor("draft_file", { accept: ["image/jpeg", "image/png"] })!;
    expect(validateDeclared(images, { filename: "deck.pdf", contentType: "application/pdf", sizeBytes: 2_048 })).toMatchObject({ ok: false, violation: "extension" });

    const documents = policyFor("draft_file", { accept: ["application/pdf"] })!;
    expect(validateDeclared(documents, { filename: "headshot.png", contentType: "image/png", sizeBytes: 2_048 })).toMatchObject({ ok: false, violation: "extension" });
    expect(validateDeclared(documents, { filename: "deck.pdf", contentType: "application/pdf", sizeBytes: 2_048 })).toMatchObject({ ok: true });
  });

  test("CONTRACT · accept lists narrow whether they are written as MIME types or as extensions", () => {
    // A form field stores what the file input consumes; a task template may
    // store a bare extension. Matching only one vocabulary narrows the other
    // to an empty rule set, which rejects every file while looking correct.
    for (const accept of [["image/png"], ["png"], [".png"], ["PNG"]]) {
      const policy = policyFor("draft_file", { accept })!;
      expect(policy.rules.map((rule) => rule.extension)).toContain("png");
      expect(validateDeclared(policy, { filename: "headshot.png", contentType: "image/png", sizeBytes: 2_048 })).toMatchObject({ ok: true });
    }
  });

  test("CONTRACT · a filename whose extension disagrees with its declared MIME is refused", () => {
    const policy = policyFor("draft_file", { accept: ["image/jpeg", "image/png"] })!;
    expect(validateDeclared(policy, { filename: "headshot.png", contentType: "image/jpeg", sizeBytes: 2_048 })).toMatchObject({ ok: false, violation: "mime" });
    expect(validateDeclared(policy, { filename: "headshot.jpg", contentType: "image/png", sizeBytes: 2_048 })).toMatchObject({ ok: false, violation: "mime" });
    // A document renamed to look like an image is refused on the declared MIME,
    // before the magic-byte check at completion ever sees it.
    expect(validateDeclared(policy, { filename: "payload.png", contentType: "application/pdf", sizeBytes: 2_048 })).toMatchObject({ ok: false, violation: "mime" });
  });

  test("CONTRACT · the field's declared ceiling and the empty-file floor still bind", () => {
    const policy = policyFor("draft_file", { accept: ["image/png"], maxBytes: 1_024 })!;
    expect(validateDeclared(policy, { filename: "headshot.png", contentType: "image/png", sizeBytes: 2_048 })).toMatchObject({ ok: false, violation: "too_large" });
    expect(validateDeclared(policy, { filename: "headshot.png", contentType: "image/png", sizeBytes: 0 })).toMatchObject({ ok: false, violation: "empty" });
  });

  test("CONTRACT · an authenticated task upload is not widened to images by the public-form fix", () => {
    const policy = policyFor("task_upload", {})!;
    expect(policy.rules.map((rule) => rule.extension)).not.toContain("png");
    expect(validateDeclared(policy, { filename: "headshot.png", contentType: "image/png", sizeBytes: 2_048 })).toMatchObject({ ok: false, violation: "extension" });
  });
});
