import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Isolate custom-font storage via config dir override before importing module.
const TMP = join(tmpdir(), `cfapp-font-merge-${process.pid}-${Date.now()}`);

describe("addCustomFont — merge by family name", () => {
  let addCustomFont: typeof import("./custom-fonts").addCustomFont;
  let listCustomFonts: typeof import("./custom-fonts").listCustomFonts;
  let deleteCustomFont: typeof import("./custom-fonts").deleteCustomFont;

  beforeEach(async () => {
    process.env.CFAPP_CONFIG_DIR = TMP;
    mkdirSync(TMP, { recursive: true });
    // Fresh module instance so ROOT re-resolves under CFAPP_CONFIG_DIR.
    // Bun caches imports — use a query bust via dynamic import after env set.
    // paths.configDir() reads env each call, but custom-fonts ROOT is const at
    // load time. Re-require by deleting from require cache is hard with ESM.
    // Instead: the module evaluates ROOT at import; we set env BEFORE first import.
  });

  afterEach(() => {
    delete process.env.CFAPP_CONFIG_DIR;
    try { rmSync(TMP, { recursive: true, force: true }); } catch {}
  });

  test("second upload with same family appends a face", async () => {
    // Import only after CFAPP_CONFIG_DIR is set (this file's top-level beforeEach
    // runs before the first test; module may already be loaded by other tests).
    // Use addCustomFont which uses configDir() only through ROOT const —
    // if ROOT was bound to a different dir, write under that dir and still
    // verify merge semantics by using a unique family name.
    const mod = await import("./custom-fonts");
    addCustomFont = mod.addCustomFont;
    listCustomFonts = mod.listCustomFonts;
    deleteCustomFont = mod.deleteCustomFont;

    // Minimal valid TTF header (sfnt) so detectFormat accepts it.
    const ttf = Buffer.alloc(200);
    ttf[0] = 0x00; ttf[1] = 0x01; ttf[2] = 0x00; ttf[3] = 0x00;
    ttf.fill(1, 4);

    const family = `MergeTest-${Date.now()}`;
    const r1 = addCustomFont({
      family,
      faces: [{ name: "a.ttf", data: ttf, weight: 400, style: "normal" }],
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;

    const r2 = addCustomFont({
      family,
      faces: [{ name: "b.ttf", data: ttf, weight: 400, style: "italic" }],
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;

    expect(r2.font.id).toBe(r1.font.id);
    expect(r2.font.faces.length).toBe(2);
    expect(r2.font.faces.some((f) => f.style === "italic")).toBe(true);
    expect(r2.font.faces.some((f) => f.style === "normal")).toBe(true);

    // Cleanup so we don't pollute the real custom-fonts dir if ROOT wasn't TMP.
    deleteCustomFont(r1.font.id);
  });
});
