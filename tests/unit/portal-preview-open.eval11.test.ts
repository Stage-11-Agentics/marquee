import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import {
  PREVIEW_BLOCKED_MESSAGE,
  openPortalPreview,
  type PreviewTab,
} from "../../src/ui/speakers/portal-preview";

/**
 * sbek round 11, manual SPK-07: "Open portal as this speaker →" opened a tab
 * that stayed blank forever. It is on the eleven-step walkthrough spine, where
 * a dead end is a defect whoever finds it.
 *
 * The cause was `window.open(url, target, "noopener,noreferrer")`, which
 * returns **null by specification** — the flag severs the handle along with the
 * opener. Measured in a live browser:
 *
 *     noopener -> handle=NULL | plain -> handle=yes | setLocation -> ok
 *
 * A window stand-in that reproduces that rule is what makes these assertions
 * worth anything: a fake that hands back a handle regardless of the features
 * string would have passed against the broken code.
 */

/** A pop-up handle, plus a record of what was done to it. */
function tab(): PreviewTab & { closed: boolean } {
  return { location: { href: "about:blank" }, opener: {}, closed: false, close() { this.closed = true; } };
}

/**
 * `window.open` as a browser implements it, for the one rule that matters here:
 * a `noopener` request creates the tab and returns nothing to steer it with.
 */
function browserOpen(options: { blocked?: boolean } = {}) {
  const opened: Array<{ url: string; target: string; features?: string; tab: ReturnType<typeof tab> | null }> = [];
  const open = (url: string, target: string, features?: string): PreviewTab | null => {
    const blocked = options.blocked === true;
    const handleless = blocked || (features ?? "").includes("noopener");
    const created = handleless ? null : tab();
    opened.push({ url, target, features, tab: created });
    return created;
  };
  return { open, opened };
}

const URL_MINTED = "https://marquee.stage11.dev/portal/s/tok_abc";

describe("open portal as this speaker", () => {
  test("CONTRACT · the tab the click opened is the tab that gets navigated", async () => {
    const browser = browserOpen();
    const outcome = await openPortalPreview({
      open: browser.open,
      previewUrl: async () => URL_MINTED,
      describeError: () => "unused",
    });

    expect(outcome).toEqual({ ok: true });
    // Exactly one tab: a second `window.open` after the await is a pop-up with
    // no user gesture behind it, which is suppressed rather than shown.
    expect(browser.opened).toHaveLength(1);
    const [first] = browser.opened;
    expect(first.tab, "the first open must return a handle").not.toBeNull();
    expect(first.tab?.location.href).toBe(URL_MINTED);
    expect(first.tab?.closed).toBe(false);
  });

  test("CONTRACT · the tab is requested without noopener, and its opener severed instead", async () => {
    const browser = browserOpen();
    await openPortalPreview({ open: browser.open, previewUrl: async () => URL_MINTED, describeError: () => "unused" });

    // The literal flag that returned null, named so a well-meaning re-hardening
    // reintroduces the dead end loudly rather than quietly.
    expect(browser.opened[0]?.features ?? "").not.toContain("noopener");
    expect(browser.opened[0]?.features ?? "").not.toContain("noreferrer");
    // What the flag was there for still holds: the preview tab cannot reach
    // back into the organizer's session through `window.opener`.
    expect(browser.opened[0]?.tab?.opener).toBeNull();
  });

  test("CONTRACT · a blocked pop-up says so rather than reporting success", async () => {
    const browser = browserOpen({ blocked: true });
    let minted = 0;
    const outcome = await openPortalPreview({
      open: browser.open,
      previewUrl: async () => { minted += 1; return URL_MINTED; },
      describeError: () => "unused",
    });

    expect(outcome).toEqual({ ok: false, message: PREVIEW_BLOCKED_MESSAGE });
    // No second attempt, and no preview token minted for a tab that will never
    // consume it.
    expect(browser.opened).toHaveLength(1);
    expect(minted).toBe(0);
    expect(PREVIEW_BLOCKED_MESSAGE).toMatch(/pop-?up/i);
  });

  test("CONTRACT · a failed mint closes the blank tab and reports why", async () => {
    const browser = browserOpen();
    const outcome = await openPortalPreview({
      open: browser.open,
      previewUrl: async () => { throw new Error("boom"); },
      describeError: (caught) => `said: ${(caught as Error).message}`,
    });

    expect(outcome).toEqual({ ok: false, message: "said: boom" });
    expect(browser.opened[0]?.tab?.closed).toBe(true);
    expect(browser.opened[0]?.tab?.location.href).toBe("about:blank");
  });

  test("CONTRACT · the tab is opened before anything is awaited", async () => {
    // The user gesture that authorises a pop-up does not survive an await, so
    // the ordering is the fix and not an implementation detail.
    const browser = browserOpen();
    let openedWhenMintCalled = -1;
    const pending = openPortalPreview({
      open: browser.open,
      previewUrl: async () => { openedWhenMintCalled = browser.opened.length; return URL_MINTED; },
      describeError: () => "unused",
    });

    // Synchronously after the call, before any microtask has run.
    expect(browser.opened).toHaveLength(1);
    await pending;
    expect(openedWhenMintCalled).toBe(1);
  });

  test("CONTRACT · the speaker record owns no window.open of its own", () => {
    // The assertions above cover the module; this one covers the seam they
    // cannot reach, because the screen has no DOM to click in this project. It
    // is a source read on purpose, and it is narrow on purpose: the only
    // `window.open` in the record must be the delegate handed to the module, so
    // a second one — the after-await fallback that could never fire — cannot
    // come back without failing here.
    const source = readFileSync(new URL("../../src/ui/speakers/SpeakerRecord.tsx", import.meta.url), "utf8");
    expect([...source.matchAll(/window\.open\(/g)]).toHaveLength(1);
    expect(source).not.toContain("noopener");
    expect(source).toContain("runPortalPreview");
  });
});
