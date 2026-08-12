import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { THEMES, THEME_STORAGE_KEY, SWYXY_MODE_STORAGE_KEY, applyTheme, applySwyxyMode, isThemeId, readSwyxyMode, readTheme, writeSwyxyMode, writeTheme } from "../../src/ui/shell/theme";

const root = resolve(import.meta.dirname, "../..");

// theme.ts touches exactly two globals. Standing them up here keeps the test in
// the Worker-free pool: a theme toggle should not cost a Miniflare isolate.
type FakeStorage = { store: Map<string, string>; throwOn?: "get" | "set" };

function installDom(storage: FakeStorage | null): void {
  const dataset: Record<string, string> = {};
  (globalThis as Record<string, unknown>).document = {
    documentElement: {
      dataset: new Proxy(dataset, {
        deleteProperty(target, key: string) { delete target[key]; return true; },
      }),
    },
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
});
