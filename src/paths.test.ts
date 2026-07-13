import { describe, test, expect } from "bun:test";
import { join } from "path";
import { homedir } from "os";
import {
  canonicalizePath,
  isAllowedFontImportPath,
  hostPlatform,
} from "./paths";

describe("canonicalizePath", () => {
  test("collapses .. segments", () => {
    const home = homedir();
    const sneaky = join(home, "foo", "..", "..", "etc", "passwd");
    const c = canonicalizePath(sneaky);
    expect(c).toBeTruthy();
    // Must not still contain ".." after resolve
    expect(c!.includes("..")).toBe(false);
    // On Unix this typically lands outside home
    if (hostPlatform() !== "win32") {
      expect(c!.startsWith(home + "/")).toBe(false);
    }
  });
});

describe("isAllowedFontImportPath", () => {
  test("accepts a path under home", () => {
    const p = join(homedir(), ".local", "share", "fonts", "Example.ttf");
    // File need not exist — allowlist is path-based after resolve
    expect(isAllowedFontImportPath(p)).toBe(true);
  });

  test("rejects path traversal out of home", () => {
    const p = join(homedir(), "..", "..", "etc", "passwd");
    expect(isAllowedFontImportPath(p)).toBe(false);
  });

  test("rejects empty", () => {
    expect(isAllowedFontImportPath("")).toBe(false);
  });

  test("accepts system font dirs on this platform", () => {
    if (hostPlatform() === "linux") {
      expect(isAllowedFontImportPath("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")).toBe(true);
    } else if (hostPlatform() === "darwin") {
      expect(isAllowedFontImportPath("/System/Library/Fonts/Supplemental/Georgia.ttf")).toBe(true);
    } else if (hostPlatform() === "win32") {
      const windir = process.env.WINDIR || "C:\\Windows";
      expect(isAllowedFontImportPath(join(windir, "Fonts", "georgia.ttf"))).toBe(true);
    }
  });
});
