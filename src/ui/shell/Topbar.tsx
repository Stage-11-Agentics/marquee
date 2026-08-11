import type { JSX } from "preact";

export function Topbar({ eventName, routeName, userInitials, openSearch, openUser }: { eventName: string; routeName: string; userInitials: string; openSearch: () => void; openUser: () => void }): JSX.Element {
  return <header class="topbar">
    <div class="breadcrumbs">{eventName}&nbsp; / &nbsp;<strong>{routeName}</strong></div>
    <div class="global-search">
      <span class="search-glyph" aria-hidden="true">⌕</span>
      <button type="button" data-global-search-trigger onClick={openSearch} aria-haspopup="dialog">Search abstracts, speakers, sessions…</button>
      <span class="shortcut">⌘K</span>
    </div>
    <button type="button" class="top-user" aria-label="Open user menu" onClick={openUser}>{userInitials}</button>
  </header>;
}
