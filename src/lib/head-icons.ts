/**
 * The icon links every Marquee document carries.
 *
 * The head that ships is `index.html`: every HTML route fetches it through the
 * ASSETS binding and rewrites it, so one set of tags there covers the SPA, the
 * landing page, the public agenda, the public form, and the embeds.
 *
 * These constants exist for the other branch — the hand-written fallback
 * documents those routes emit when ASSETS is unavailable, and the standalone
 * calendar page, which never reads the shell at all. A degraded page should
 * still be recognisably Marquee in the tab.
 *
 * Keep in sync with `index.html`.
 */
export const ICON_LINKS =
  '<link rel="icon" href="/favicon.svg" type="image/svg+xml">' +
  '<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">' +
  '<link rel="icon" href="/favicon.ico" sizes="16x16 32x32">' +
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">';
