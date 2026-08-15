import type { JSX } from "preact";
import { AccountMenu, type Identity } from "./identity";
import { ThemeSwitch } from "./ThemeSwitch";
import { chromeFor, useThemeId } from "./register";

/** A route sits under Submissions when a "Submissions" crumb belongs between
 * the conference name and the route itself; the submissions list route is its
 * own destination and does not crumb to itself. */
function submissionsCrumb(pathname: string): boolean {
  return pathname.startsWith("/submissions/");
}

export function Topbar({ eventName, routeName, scopeName, scopeHref = "/dashboard", pathname = "", identity, userMenuOpen, openSearch, toggleUser, closeUser, navigate = (target) => { window.location.assign(target); }, drawerOpen = false, onOpenNavigation = () => {}, navigationButtonRef }: {
  eventName: string;
  routeName: string;
  /**
   * What the leading crumb names, when it is not the conference. An
   * organization-level screen outlives every conference in it, so crumbing to
   * one would misdescribe where the operator is standing.
   */
  scopeName?: string;
  /** Where that leading crumb goes. Defaults to the conference dashboard. */
  scopeHref?: string;
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
  drawerOpen?: boolean;
  onOpenNavigation?: () => void;
  navigationButtonRef?: { current: HTMLButtonElement | null };
}): JSX.Element {
  const crumbTo = (target: string) => (event: MouseEvent) => { event.preventDefault(); navigate(target); };
  // The theme is presentational and owned by the document; ThemeSwitch owns
  // its control while this read selects the register-specific search glyph.
  const theme = useThemeId();
  const chrome = chromeFor(theme);
  return <header class="topbar">
    <button
      ref={navigationButtonRef}
      type="button"
      class="mobile-nav-trigger"
      aria-label="Open navigation"
      aria-expanded={drawerOpen}
      aria-controls="primary-navigation"
      onClick={onOpenNavigation}
    ><span class="mobile-nav-ink" aria-hidden="true"><i /><i /><i /></span></button>
    <button type="button" class="mobile-event-context" onClick={onOpenNavigation}>{eventName}</button>
    <div class="breadcrumbs">
      <a href={scopeHref} onClick={crumbTo(scopeHref)}>{scopeName ?? eventName}</a>&nbsp; / &nbsp;
      {submissionsCrumb(pathname) && <><a href="/submissions" onClick={crumbTo("/submissions")}>Submissions</a>&nbsp; / &nbsp;</>}
      <strong>{routeName}</strong>
    </div>
    <div class="global-search">
      <span class="search-glyph" aria-hidden="true">{chrome.searchGlyph}</span>
      <button type="button" data-global-search-trigger onClick={openSearch} aria-haspopup="dialog">Search abstracts, speakers, sessions…</button>
      <span class="shortcut">⌘K</span>
    </div>
    <button type="button" class="mobile-search-trigger" aria-label="Search" onClick={openSearch} aria-haspopup="dialog">
      <span class="search-glyph" aria-hidden="true">{chrome.searchGlyph}</span>
    </button>
    <ThemeSwitch />
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
