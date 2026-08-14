/** @jsxImportSource preact */

import type { JSX } from "preact";

import { splitSocialLinks, type SocialPlatform } from "../../lib/social-links";
// `social-badge.css` is deliberately not imported here. This component renders
// in the client bundle and in the server-rendered public site, and those two
// carry their stylesheets differently — the portal `@import`s the file, the
// public shell inlines it with `?raw`. One file, two deliveries.

/**
 * The speaker's social profiles, wherever they are shown.
 *
 * One component serves the portal, the organizer's record and the public site,
 * which is the point: a badge that looked different on the public page from the
 * one the speaker approved in their portal would be a small lie. It carries no
 * palette of its own — the mark is `currentColor` and the chrome is drawn from
 * the inherited text color — so it takes the light of whatever surface it lands
 * on, admin themes and the public site alike.
 */

const MARKS: Record<string, string> = {
  // Both marks are the platforms' own, drawn at 24×24 and used as identifying
  // marks on a link to that platform, which is what their brand terms allow.
  x: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
  linkedin: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
};

export function SocialMark({ platform }: { platform: SocialPlatform }): JSX.Element | null {
  const path = MARKS[platform.id];
  if (!path) return null;
  return <svg class="social-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={path} /></svg>;
}

function LinkMark(): JSX.Element {
  return <svg class="social-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
    <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
  </svg>;
}

/**
 * `rel="me"` states that the profile is the same person as this page, which is
 * what a speaker list is claiming anyway; `noopener noreferrer` is the ordinary
 * hygiene for a link the conference does not control.
 */
const LINK_REL = "me noopener noreferrer";

export function SocialBadges({ links, ownerName, size = "regular" }: { links: readonly string[]; ownerName: string; size?: "regular" | "compact" }): JSX.Element | null {
  const { profiles, other } = splitSocialLinks(links);
  if (profiles.length === 0 && other.length === 0) return null;
  return <ul class={`social-badges social-badges-${size}`}>
    {profiles.map(({ platform, handle, url }) => (
      <li key={url}>
        <a class="social-badge" href={url} target="_blank" rel={LINK_REL} aria-label={`${ownerName} on ${platform.label}`}>
          <SocialMark platform={platform} />
          <span>{platform.display(handle)}</span>
        </a>
      </li>
    ))}
    {other.map((url) => (
      <li key={url}>
        <a class="social-badge" href={url} target="_blank" rel={LINK_REL} aria-label={`${ownerName}: ${url}`}>
          <LinkMark />
          <span>{hostOf(url)}</span>
        </a>
      </li>
    ))}
  </ul>;
}

function hostOf(url: string): string {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
