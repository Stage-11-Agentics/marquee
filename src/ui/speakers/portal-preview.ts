/**
 * "Open portal as this speaker" — opening a tab now and navigating it later.
 *
 * The organizer's click is the only moment a browser will let a tab be opened,
 * and the URL to put in it does not exist yet: it is minted by a POST that must
 * be awaited. So the tab is opened first, blank, and navigated when the URL
 * arrives. That much the screen already did.
 *
 * What it got wrong was the flag. `window.open(url, target, "noopener")`
 * returns **null by specification** — severing the opener relationship also
 * severs the handle, which is the whole point of the flag. The tab still
 * appeared; nothing could ever navigate it. Measured in a live browser:
 *
 *     noopener -> handle=NULL
 *     plain    -> handle=yes; opener=null assignment ok; deferred
 *                 location.href assignment ok
 *
 * So the tab is opened plainly and its `opener` set to null immediately, which
 * the HTML specification defines as severing the opener browsing context — the
 * property `noopener` was there for — while leaving a navigable handle behind.
 * The preview URL is same-origin, so this was defensive rather than
 * load-bearing in the first place.
 *
 * There is deliberately no second `window.open` after the await. One was there,
 * as a fallback for the null handle, and it could not work by construction: a
 * pop-up opened after an await carries no user gesture and every browser
 * suppresses it. Its presence is what made the failure silent — the button
 * reported success, and the organizer was left staring at a blank tab. A blocked
 * pop-up now says so.
 */

/** The part of a pop-up handle this module touches. */
export interface PreviewTab {
  location: { href: string };
  opener: unknown;
  close(): void;
}

/**
 * `window.open`, narrowed to what is used here so a test can stand in for it.
 *
 * `features` is in the signature precisely because it is never passed: a stand-in
 * that honours the `noopener` rule can then fail loudly if it ever is.
 */
export type TabOpener = (url: string, target: string, features?: string) => PreviewTab | null;

/**
 * Said when the browser refused the tab. Names the cause and the fix, because
 * "could not open" sends an organizer looking for a bug in the speaker record.
 */
export const PREVIEW_BLOCKED_MESSAGE =
  "Your browser blocked the portal preview tab. Allow pop-ups for this site, then try again.";

export type PreviewOutcome = { ok: true } | { ok: false; message: string };

/**
 * Opens the tab, mints the URL, navigates the tab.
 *
 * `open` must be called synchronously against the organizer's click — it is the
 * first thing this function does, before anything awaits, and moving it later
 * reintroduces the defect.
 */
export async function openPortalPreview(options: {
  open: TabOpener;
  previewUrl: () => Promise<string>;
  describeError: (caught: unknown) => string;
}): Promise<PreviewOutcome> {
  const tab = options.open("about:blank", "_blank");
  // Severing the opener is what `noopener` was asked for; done this way it
  // costs nothing, because the handle is already in hand.
  if (tab) tab.opener = null;
  // No handle means no tab this code can ever navigate, so say so now rather
  // than minting a preview token that nothing will consume.
  if (!tab) return { ok: false, message: PREVIEW_BLOCKED_MESSAGE };

  try {
    tab.location.href = await options.previewUrl();
    return { ok: true };
  } catch (caught) {
    tab.close();
    return { ok: false, message: options.describeError(caught) };
  }
}
