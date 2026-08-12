import type { JSX } from "preact";
import { AccountMenu, type Identity } from "./identity";

export function Topbar({ eventName, routeName, identity, userMenuOpen, openSearch, toggleUser, closeUser }: {
  eventName: string;
  routeName: string;
  identity: Identity | null;
  userMenuOpen: boolean;
  openSearch: () => void;
  toggleUser: () => void;
  closeUser: () => void;
}): JSX.Element {
  return <header class="topbar">
    <div class="breadcrumbs">{eventName}&nbsp; / &nbsp;<strong>{routeName}</strong></div>
    <div class="global-search">
      <span class="search-glyph" aria-hidden="true">⌕</span>
      <button type="button" data-global-search-trigger onClick={openSearch} aria-haspopup="dialog">Search abstracts, speakers, sessions…</button>
      <span class="shortcut">⌘K</span>
    </div>
    {/*
      Fixed width, and rendered whether or not the read has landed: the slot
      holds its place with an em dash rather than appearing later and shoving
      the avatar sideways. Elements never jump.
    */}
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
