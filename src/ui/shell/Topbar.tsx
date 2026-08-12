import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { AccountMenu, type Identity } from "./identity";
import { THEMES, isThemeId, writeSwyxyMode, writeTheme } from "./theme";
import { chromeFor, ensureThemeAssets, useSwyxyMode, useThemeId } from "./register";

/** A route sits under Submissions when a "Submissions" crumb belongs between
 * the conference name and the route itself; the submissions list route is its
 * own destination and does not crumb to itself. */
function submissionsCrumb(pathname: string): boolean {
  return pathname.startsWith("/submissions/");
}

export function Topbar({ eventName, routeName, pathname = "", identity, userMenuOpen, openSearch, toggleUser, closeUser, navigate = (target) => { window.location.assign(target); } }: {
  eventName: string;
  routeName: string;
  /** Omitted by shells that carry their own chrome (e.g. Delivery health) — the
   * breadcrumb then degrades to a real browser navigation and skips the
   * Submissions crumb, rather than requiring every host to wire client routing. */
  pathname?: string;
  identity: Identity | null;
  userMenuOpen: boolean;
  openSearch: () => void;
  toggleUser: () => void;
  closeUser: () => void;
  navigate?: (target: string) => void;
}): JSX.Element {
  const crumbTo = (target: string) => (event: MouseEvent) => { event.preventDefault(); navigate(target); };
  // The theme is presentational and owned by the document, not by app state:
  // index.html stamps it before first paint and `writeTheme` moves it, so the
  // select reads the attribute through the same subscription every other
  // consumer uses. Keeping a second copy in local state here is how the
  // select and the document drift apart on a `?theme=` comparison link.
  const theme = useThemeId();
  const chrome = chromeFor(theme);
  const swyxyMode = useSwyxyMode();
  return <header class="topbar">
    <div class="breadcrumbs">
      <a href="/dashboard" onClick={crumbTo("/dashboard")}>{eventName}</a>&nbsp; / &nbsp;
      {submissionsCrumb(pathname) && <><a href="/submissions" onClick={crumbTo("/submissions")}>Submissions</a>&nbsp; / &nbsp;</>}
      <strong>{routeName}</strong>
    </div>
    <div class="global-search">
      <span class="search-glyph" aria-hidden="true">{chrome.searchGlyph}</span>
      <button type="button" data-global-search-trigger onClick={openSearch} aria-haspopup="dialog">Search abstracts, speakers, sessions…</button>
      <span class="shortcut">⌘K</span>
    </div>
    {/*
      Fixed width, and rendered whether or not the read has landed: the slot
      holds its place with an em dash rather than appearing later and shoving
      the avatar sideways. Elements never jump.
    */}
    {/*
      A select rather than a toggle: the registry takes arbitrary themes, and
      a select holds one fixed width however many are registered. Elements
      never jump.
    */}
    <label class="theme-switch" title="Theme">
      <span class="glyph" aria-hidden="true">◐</span>
      <select
        aria-label="Theme"
        value={theme}
        onChange={(event) => {
          const next = (event.currentTarget as HTMLSelectElement).value;
          if (!isThemeId(next)) return;
          writeTheme(next);
          ensureThemeAssets(next);
        }}
      >{THEMES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
    </label>
    {/*
      swyxy's dark-mode control is the lowercase word itself, exactly like the
      swyx.io nav — a word, not a switch. Fixed width: "dark" and "light" hold
      the same slot, so the identity block never shifts. Elements never jump.
    */}
    {/*
      The visible word is the destination, not the current state ("light"
      while dark is on), so `aria-pressed` would announce the opposite of what
      it reads. An explicit action label says the same thing out loud.
    */}
    {chrome.darkToggle && <button
      type="button"
      class="swyxy-mode"
      aria-label={swyxyMode === "dark" ? "Switch to the light register" : "Switch to the dark register"}
      onClick={() => writeSwyxyMode(swyxyMode === "dark" ? "light" : "dark")}
    >{swyxyMode === "dark" ? "light" : "dark"}</button>}
    <div class="top-identity" data-identity>
      <strong>{identity?.name ?? "—"}</strong>
      <span>{identity?.role ?? "—"}</span>
    </div>
    <div class="top-user-anchor">
      <button
        type="button"
        class="top-user"
        aria-label={identity ? `Account: ${identity.name}, ${identity.role}` : "Open account menu"}
        aria-haspopup="menu"
        aria-expanded={userMenuOpen}
        onClick={toggleUser}
      >{identity?.initials ?? "—"}</button>
      {userMenuOpen ? <AccountMenu identity={identity} onClose={closeUser} /> : null}
    </div>
  </header>;
}
