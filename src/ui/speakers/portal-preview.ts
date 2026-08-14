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
 * The severance is recorded on the browsing context rather than the document,
 * so it survives the navigation. The preview URL is same-origin anyway (the
 * route mints it from `new URL(context.req.url).origin`, and the client asks
 * over a relative path), so this was defensive rather than load-bearing.
 *
 * There is deliberately no second `window.open` after the await. It was a
 * fallback for the null handle, and it is unreachable: the only way to arrive
 * there is `open` having returned null, which now means the pop-up blocker
 * refused a request made under a real gesture and will refuse the identical
 * second one. (Not, as it is tempting to say, because an await always costs the
 * gesture — transient activation is time-based, a few seconds, so after a fast
 * POST the second open would often have succeeded. That is why the symptom read
 * as an eternally blank tab in some browsers and a stray extra tab in others.)
 * Either way its presence is what made the failure silent — the button reported
 * success and the organizer was left staring at a blank tab. A blocked pop-up
 * now says so.
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
  let tab: PreviewTab | null;
  try {
    tab = options.open("about:blank", "_blank");
    // Severing the opener is what `noopener` was asked for; done this way it
    // costs nothing, because the handle is already in hand.
    if (tab) tab.opener = null;
  } catch (caught) {
    // Neither call is expected to throw. If one ever does, it must arrive as a
    // sentence in the panel: an escaping rejection here is the silent failure
    // this module exists to end, entering by a different door.
    return { ok: false, message: options.describeError(caught) };
  }
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
