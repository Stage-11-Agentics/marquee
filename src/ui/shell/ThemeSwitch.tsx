import type { JSX } from "preact";
import { THEMES, isThemeId, writeSwyxyMode, writeTheme } from "./theme";
import { chromeFor, ensureThemeAssets, useSwyxyMode, useThemeId } from "./register";

/**
 * The document-owned theme control used by shells that carry their own chrome
 * as well as the admin topbar. Keeping it here means a seat can bring the
 * register with it without growing a second persistence path.
 */
export function ThemeSwitch(): JSX.Element {
  // The theme is presentational and owned by the document, not by app state:
  // index.html stamps it before first paint and `writeTheme` moves it, so the
  // select reads the attribute through the same subscription every other
  // consumer uses. Keeping a second copy in local state here is how the
  // select and the document drift apart on a `?theme=` comparison link.
  const theme = useThemeId();
  const chrome = chromeFor(theme);
  const swyxyMode = useSwyxyMode();

  return <>
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
  </>;
}
