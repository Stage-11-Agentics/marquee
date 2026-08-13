import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { THEMES, THEME_STORAGE_KEY, THEME_CHROME_COLOR, SWYXY_DARK_CHROME_COLOR, SWYXY_MODE_STORAGE_KEY, applyTheme, applySwyxyMode, domSwyxyMode, domTheme, isThemeId, readSwyxyMode, readTheme, themeIcons, writeSwyxyMode, writeTheme } from "../../src/ui/shell/theme";
import { chromeFor } from "../../src/ui/shell/register";
import { routeTable } from "../../src/ui/shell/route-table";

const root = resolve(import.meta.dirname, "../..");

// theme.ts touches exactly two globals. Standing them up here keeps the test in
// the Worker-free pool: a theme toggle should not cost a Miniflare isolate.
type FakeStorage = { store: Map<string, string>; throwOn?: "get" | "set" };

// The head tags the theme dresses — enough of an element for a swap-and-replace
// to be observable, and nothing more.
class FakeElement {
  attrs: Record<string, string> = {};
  constructor(readonly id: string, private readonly head: Map<string, FakeElement>) {}
  getAttribute(name: string): string | null { return this.attrs[name] ?? null; }
  setAttribute(name: string, value: string): void { this.attrs[name] = value; }
  cloneNode(): FakeElement {
    const clone = new FakeElement(this.id, this.head);
    clone.attrs = { ...this.attrs };
    return clone;
  }
  replaceWith(next: FakeElement): void { this.head.set(this.id, next); }
}

let head: Map<string, FakeElement>;

function installDom(storage: FakeStorage | null): void {
  const dataset: Record<string, string> = {};
  head = new Map();
  // The tags index.html ships, in the state a fresh Day document has them.
  for (const [id, attrs] of [
    ["icon-svg", { href: "/favicon.svg" }],
    ["icon-png", { href: "/favicon-32.png" }],
    ["theme-color-meta", { content: THEME_CHROME_COLOR.day }],
  ] as const) {
    const element = new FakeElement(id, head);
    element.attrs = { ...attrs };
    head.set(id, element);
  }
  (globalThis as Record<string, unknown>).document = {
    documentElement: {
      dataset: new Proxy(dataset, {
        deleteProperty(target, key: string) { delete target[key]; return true; },
      }),
    },
    getElementById: (id: string) => head.get(id) ?? null,
  };
  (globalThis as Record<string, unknown>).localStorage = storage
    ? {
        getItem(key: string) {
          if (storage.throwOn === "get") throw new Error("private mode");
          return storage.store.get(key) ?? null;
        },
        setItem(key: string, value: string) {
          if (storage.throwOn === "set") throw new Error("quota exceeded");
          storage.store.set(key, value);
        },
      }
    : undefined;
}

function currentAttribute(): string | undefined {
  return (globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } })
    .document.documentElement.dataset.theme;
}

function currentSwyxyMode(): string | undefined {
  return (globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } })
    .document.documentElement.dataset.swyxyMode;
}

let storage: FakeStorage;

beforeEach(() => {
  storage = { store: new Map() };
  installDom(storage);
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).localStorage;
});

describe("MRQ-103 · theme system", () => {
  test("CONTRACT · Day is the default and carries no attribute, so an unstyled document is still the designed light palette", () => {
    expect(readTheme()).toBe("day");
    applyTheme("day");
    expect(currentAttribute()).toBeUndefined();
  });

  test("CONTRACT · Night sets the attribute the tokens key on, and round-trips through storage", () => {
    writeTheme("night");
    expect(currentAttribute()).toBe("night");
    expect(storage.store.get(THEME_STORAGE_KEY)).toBe("night");
    expect(readTheme()).toBe("night");
  });

  test("CONTRACT · switching back to Day removes the attribute rather than setting an empty one", () => {
    writeTheme("night");
    writeTheme("day");
    // A lingering data-theme="" would still match [data-theme] selectors.
    expect(currentAttribute()).toBeUndefined();
    expect(readTheme()).toBe("day");
  });

  test("CONTRACT · an unknown or corrupt stored value falls back to Day instead of a themeless document", () => {
    storage.store.set(THEME_STORAGE_KEY, "vaporwave");
    expect(readTheme()).toBe("day");
    storage.store.set(THEME_STORAGE_KEY, "");
    expect(readTheme()).toBe("day");
  });

  test("CONTRACT · storage that throws (private mode) still yields Day rather than an exception", () => {
    storage.throwOn = "get";
    expect(() => readTheme()).not.toThrow();
    expect(readTheme()).toBe("day");
  });

  test("CONTRACT · a theme that cannot be persisted is still applied for this session", () => {
    storage.throwOn = "set";
    expect(() => writeTheme("night")).not.toThrow();
    expect(currentAttribute()).toBe("night");
  });

  test("CONTRACT · isThemeId gates the select's value before it reaches the document", () => {
    expect(isThemeId("night")).toBe(true);
    expect(isThemeId("midnight")).toBe(false);
    expect(isThemeId(null)).toBe(false);
  });

  test("CONTRACT · the pre-paint script agrees with the module on key and value", () => {
    // These are two independent implementations of the same contract — the
    // inline script must stamp exactly what the module later reads, or the
    // app flashes the wrong palette and then corrects itself.
    const shell = readFileSync(resolve(root, "index.html"), "utf8");
    expect(shell).toContain(THEME_STORAGE_KEY);
    expect(shell).toMatch(/dataset\.theme/);
    for (const theme of THEMES) {
      if (theme.id === "day") continue;
      expect(shell).toContain(theme.id);
    }
  });

  test("CONTRACT · every registered theme has a matching scoped stylesheet block, so the select cannot offer a dead option", () => {
    const tokens = readFileSync(resolve(root, "src/styles/tokens.css"), "utf8");
    for (const theme of THEMES) {
      if (theme.id === "day") continue; // Day is the bare :root.
      if (theme.kind === "palette") {
        // Palette themes live in tokens.css, per the MRQ-103 invariant.
        expect(tokens).toContain(`html[data-theme="${theme.id}"]`);
      } else {
        // Register themes live in their own scoped stylesheets.
        const sheet = readFileSync(resolve(root, `src/styles/themes/${theme.id}.css`), "utf8");
        expect(sheet).toContain(`html[data-theme="${theme.id}"]`);
      }
    }
  });
});

describe("theme round · register themes", () => {
  test("CONTRACT · registry carries ids, picker labels, and kinds for both theme classes", () => {
    expect(THEMES.map((theme) => theme.id)).toEqual(["day", "night", "latent-space", "ai-engineer", "swyxy"]);
    expect(THEMES.map((theme) => theme.kind)).toEqual(["palette", "palette", "register", "register", "register"]);
    const labels = Object.fromEntries(THEMES.map((theme) => [theme.id, theme.label]));
    // swyxy and latent.space are lowercase on purpose — judge-facing casing.
    expect(labels["latent-space"]).toBe("latent.space");
    expect(labels["ai-engineer"]).toBe("AI Engineer");
    expect(labels.swyxy).toBe("swyxy");
    expect(isThemeId("latent-space")).toBe(true);
    expect(isThemeId("ai-engineer")).toBe(true);
    expect(isThemeId("swyxy")).toBe(true);
    expect(isThemeId("swyx")).toBe(false);
  });

  test("CONTRACT · a register theme sets the attribute its stylesheet keys on and round-trips through storage", () => {
    writeTheme("latent-space");
    expect(currentAttribute()).toBe("latent-space");
    expect(storage.store.get(THEME_STORAGE_KEY)).toBe("latent-space");
    expect(readTheme()).toBe("latent-space");
    writeTheme("ai-engineer");
    expect(currentAttribute()).toBe("ai-engineer");
    expect(readTheme()).toBe("ai-engineer");
  });

  test("CONTRACT · swyxy light is the attribute-less default inside the theme, mirroring Day's rule", () => {
    writeTheme("swyxy");
    expect(currentAttribute()).toBe("swyxy");
    expect(readSwyxyMode()).toBe("light");
    expect(currentSwyxyMode()).toBeUndefined();
  });

  test("CONTRACT · the dark word flips swyxy to its dark palette and persists as the one theme choice", () => {
    writeTheme("swyxy");
    writeSwyxyMode("dark");
    expect(currentSwyxyMode()).toBe("dark");
    expect(storage.store.get(SWYXY_MODE_STORAGE_KEY)).toBe("dark");
    expect(readSwyxyMode()).toBe("dark");
    // The theme itself is still the single "swyxy" choice.
    expect(storage.store.get(THEME_STORAGE_KEY)).toBe("swyxy");
    // A fresh visit stamps the mode from storage along with the theme.
    delete (globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } })
      .document.documentElement.dataset.swyxyMode;
    applyTheme("swyxy");
    expect(currentSwyxyMode()).toBe("dark");
  });

  test("CONTRACT · switching away from swyxy clears the mode attribute; corrupt mode storage falls back to light", () => {
    writeTheme("swyxy");
    writeSwyxyMode("dark");
    writeTheme("night");
    expect(currentSwyxyMode()).toBeUndefined();
    storage.store.set(SWYXY_MODE_STORAGE_KEY, "midnight");
    expect(readSwyxyMode()).toBe("light");
  });

  test("CONTRACT · mode storage that throws still yields light rather than an exception, and unpersistable flips still apply", () => {
    storage.throwOn = "get";
    expect(() => readSwyxyMode()).not.toThrow();
    expect(readSwyxyMode()).toBe("light");
    storage.throwOn = "set";
    expect(() => writeSwyxyMode("dark")).not.toThrow();
    expect(currentSwyxyMode()).toBe("dark");
  });

  test("CONTRACT · the pre-paint script stamps the mode and loads register fonts, so the first paint is already the register", () => {
    const shell = readFileSync(resolve(root, "index.html"), "utf8");
    expect(shell).toContain(SWYXY_MODE_STORAGE_KEY);
    expect(shell).toContain("swyxyMode");
    expect(shell).toContain("Syncopate");
    expect(shell).toContain("Plus+Jakarta+Sans");
    // Day and Night stay font-free: no font link exists outside the register map.
    expect(shell).not.toContain("rel=\"stylesheet\" href=\"https://fonts.googleapis.com");
  });

  test("CONTRACT · register nav labels cannot drift from the route table — a renamed route id keeps its trope or fails here", () => {
    // swyxy's lowercase nav is an override map keyed by route id. A route
    // rename would silently revert that entry to Marquee's label, and a stale
    // key would sit in the registry doing nothing. Both directions pin.
    const routeIds = new Set(routeTable.map((route) => route.id));
    const sidebarIds = new Set(
      routeTable.filter((route) => route.sidebar).map((route) => route.id),
    );
    for (const theme of THEMES) {
      if (theme.kind !== "register") continue;
      const overrides = chromeFor(theme.id).navLabels;
      for (const key of Object.keys(overrides)) {
        expect(routeIds.has(key), `${theme.id} nav label "${key}" has no route`).toBe(true);
      }
    }
    // swyxy's trope is a *complete* lowercase nav — every sidebar destination
    // carries an override, including the System group (delivery-health split).
    const swyxyOverrides = chromeFor("swyxy").navLabels;
    for (const id of sidebarIds) {
      expect(swyxyOverrides[id], `swyxy nav is missing sidebar route "${id}"`).toBeDefined();
    }
  });

  test("CONTRACT · the pre-paint script honours every theme id, including the one that stamps nothing", () => {
    // `?theme=day` is the comparison link a judge uses to check a register
    // against the default. If "day" is missing from the script's id map the
    // override silently falls through to storage: the document keeps wearing
    // the stored register while the app reports Day, so the select, the
    // search glyph and the dashboard renderers all disagree with the screen.
    const shell = readFileSync(resolve(root, "index.html"), "utf8");
    const ids = shell.match(/var ids = \{([^}]*)\}/)?.[1] ?? "";
    for (const theme of THEMES) {
      expect(ids, `pre-paint script does not accept "${theme.id}"`).toContain(`"${theme.id}"`);
    }
    // …and still refuses to stamp an attribute for Day.
    expect(shell).toContain('t !== "day"');
  });

  test("CONTRACT · the live readers answer the document, not the URL, so a comparison link cannot freeze the switcher", () => {
    // readTheme/readSwyxyMode prefer `?theme=`/`?mode=` — correct for the
    // pre-paint decision, wrong for a subscriber: on `?theme=swyxy&mode=dark`
    // the toggle would re-read "dark" from the URL after every click and the
    // control would be inert. domTheme/domSwyxyMode read what is worn.
    applyTheme("night");
    expect(domTheme()).toBe("night");
    applyTheme("day");
    expect(domTheme()).toBe("day");

    applySwyxyMode("dark");
    expect(domSwyxyMode()).toBe("dark");
    applySwyxyMode("light");
    expect(domSwyxyMode()).toBe("light");
  });

  test("CONTRACT · the tab dresses with the page: every theme points the icon links and chrome colour at its own mark", () => {
    const worn = (id: string, attr: string) => head.get(id)?.getAttribute(attr);
    for (const theme of THEMES) {
      applyTheme(theme.id);
      const icons = themeIcons(theme.id);
      expect(worn("icon-svg", "href"), `${theme.id} icon`).toBe(icons.svg);
      expect(worn("icon-png", "href"), `${theme.id} raster`).toBe(icons.png);
      expect(worn("theme-color-meta", "content"), `${theme.id} chrome`).toBe(THEME_CHROME_COLOR[theme.id]);
    }
    // …and switching back restores the shipped Day set rather than leaving the
    // last register's mark in the tab.
    applyTheme("day");
    expect(worn("icon-svg", "href")).toBe("/favicon.svg");
    expect(worn("icon-png", "href")).toBe("/favicon-32.png");
  });

  test("CONTRACT · every theme's icon files exist — the path is built from the id, so a missing asset is a blank tab, not an error", () => {
    for (const theme of THEMES) {
      const icons = themeIcons(theme.id);
      for (const href of [icons.svg, icons.png]) {
        expect(existsSync(resolve(root, "public", href.slice(1))), `${theme.id}: ${href} is not in public/`).toBe(true);
      }
    }
  });

  test("CONTRACT · swyxy's dark word moves the chrome colour and leaves the mark alone", () => {
    writeTheme("swyxy");
    expect(head.get("theme-color-meta")?.getAttribute("content")).toBe(THEME_CHROME_COLOR.swyxy);
    writeSwyxyMode("dark");
    expect(head.get("theme-color-meta")?.getAttribute("content")).toBe(SWYXY_DARK_CHROME_COLOR);
    // One indigo mark carries both swyxy palettes.
    expect(head.get("icon-svg")?.getAttribute("href")).toBe("/favicon-swyxy.svg");
    writeSwyxyMode("light");
    expect(head.get("theme-color-meta")?.getAttribute("content")).toBe(THEME_CHROME_COLOR.swyxy);
  });

  test("CONTRACT · a head without the icon tags still gets its palette — the fallback documents carry no ids", () => {
    head.clear();
    expect(() => applyTheme("latent-space")).not.toThrow();
    expect(currentAttribute()).toBe("latent-space");
  });

  test("CONTRACT · the pre-paint script dresses the same tags, so the browser never caches the wrong icon", () => {
    // As with the palette: two implementations of one contract. The script
    // runs before the icon links are fetched; applyTheme runs on every switch
    // after. A tag renamed on one side and not the other means the first paint
    // and the first toggle disagree about which mark the tab wears.
    const shell = readFileSync(resolve(root, "index.html"), "utf8");
    for (const id of ["icon-svg", "icon-png", "theme-color-meta"]) {
      expect(shell, `index.html has no #${id}`).toContain(`id="${id}"`);
      expect(shell, `the pre-paint script never dresses #${id}`).toContain(`"${id}"`);
    }
    for (const theme of THEMES) {
      if (theme.id === "day") continue; // Day is what the markup already ships.
      expect(shell, `the script's chrome colours omit ${theme.id}`).toContain(
        `"${theme.id}": "${THEME_CHROME_COLOR[theme.id]}"`,
      );
    }
    expect(shell).toContain(SWYXY_DARK_CHROME_COLOR);
    // The paths are built from the id on both sides.
    expect(shell).toContain('"/favicon-" + t + ".svg"');
    expect(shell).toContain('"/favicon-" + t + "-32.png"');
  });

  test("CONTRACT · radius stays theme-invariant — a register re-lights the instrument, it does not re-machine it", () => {
    // Structure tokens are what keep a register recognisably Marquee. A
    // register may move colour and type; moving --radius in the token block
    // reshapes every card, button and input in the product at once.
    // Every scoped block, not just the first: a dark-mode-only override like
    // html[data-theme="swyxy"][data-swyxy-mode="dark"] is exactly where this
    // would reappear, and it is the 25th block in that file, not the 1st.
    const STRUCTURE = ["--radius", "--shadow", "--hair", "--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7"];
    for (const theme of THEMES) {
      if (theme.kind !== "register") continue;
      const sheet = readFileSync(resolve(root, `src/styles/themes/${theme.id}.css`), "utf8");
      const blocks = [...sheet.matchAll(/html\[data-theme="[^"]+"\][^{]*\{([\s\S]*?)\n\}/g)].map((m) => m[1]);
      // A parse that finds nothing must fail loudly rather than pass vacuously —
      // otherwise reformatting a stylesheet silently retires the guard.
      expect(blocks.length, `${theme.id}: no scoped blocks parsed`).toBeGreaterThan(0);
      for (const block of blocks) {
        for (const token of STRUCTURE) {
          expect(block, `${theme.id} overrides the structure token ${token}`).not.toMatch(
            new RegExp(`^\\s*${token}\\s*:`, "m"),
          );
        }
      }
    }
  });
});
