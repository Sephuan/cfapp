import { describe, test, expect, beforeEach } from "bun:test";

// Minimal localStorage polyfill for bun:test (no DOM).
const store = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
};
(globalThis as any).localStorage = localStorageMock;

// document.documentElement stub for applyFont
const attrs = new Map<string, string>();
const styles = new Map<string, string>();
(globalThis as any).document = {
  documentElement: {
    setAttribute: (k: string, v: string) => { attrs.set(k, v); },
    removeAttribute: (k: string) => { attrs.delete(k); },
    style: {
      setProperty: (k: string, v: string) => { styles.set(k, v); },
      removeProperty: (k: string) => { styles.delete(k); },
    },
  },
};

describe("font preference vs MS Georgia auto-prefer", () => {
  beforeEach(() => {
    store.clear();
    attrs.clear();
    styles.clear();
  });

  test("explicit default blocks auto-prefer; missing key allows it", async () => {
    const {
      FONT_ROLES,
      FONT_DEFAULT_SENTINEL,
      applyFont,
      applyAllFonts,
      preferMicrosoftGeorgiaIfUnset,
      isFontPreferenceUnset,
      CUSTOM_FONT_CHOICE_ID,
    } = await import("./themes");

    const statement = FONT_ROLES.find((r) => r.key === "statement")!;
    expect(isFontPreferenceUnset("statement")).toBe(true);

    // First launch restore must not invent a preference.
    applyAllFonts();
    expect(isFontPreferenceUnset("statement")).toBe(true);

    // Auto-prefer should fire.
    preferMicrosoftGeorgiaIfUnset("Microsoft Georgia", ["Microsoft Georgia"]);
    expect(localStorage.getItem("cfapp:font-statement")).toBe(CUSTOM_FONT_CHOICE_ID);
    expect(localStorage.getItem("cfapp:font-statement-family")).toBe("Microsoft Georgia");

    // User switches back to built-in default.
    applyFont(statement, "", undefined, { persist: true });
    expect(localStorage.getItem("cfapp:font-statement")).toBe(FONT_DEFAULT_SENTINEL);
    expect(isFontPreferenceUnset("statement")).toBe(false);

    // Auto-prefer must NOT override explicit default.
    preferMicrosoftGeorgiaIfUnset("Microsoft Georgia", ["Microsoft Georgia"]);
    expect(localStorage.getItem("cfapp:font-statement")).toBe(FONT_DEFAULT_SENTINEL);
  });
});
