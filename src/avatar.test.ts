// Pins the avatar sniffer's core safety property: only genuine image bytes are
// accepted for caching. This is what stops a Cloudflare 200-HTML interstitial
// (or any error body) from poisoning the never-revalidated on-disk avatar cache.
import { test, expect, describe } from "bun:test";
import { sniffImageType } from "./api/avatar-cache";

const bytes = (...b: number[]) => new Uint8Array(b);

describe("sniffImageType", () => {
  test("detects JPEG / PNG / GIF / WEBP magic bytes", () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe("image/jpeg");
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a))).toBe("image/png");
    expect(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe("image/gif");
    // RIFF....WEBP
    expect(sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50))).toBe("image/webp");
  });

  test("detects SVG (with leading whitespace / BOM)", () => {
    expect(sniffImageType(new TextEncoder().encode("<svg xmlns=\"...\">"))).toBe("image/svg+xml");
    expect(sniffImageType(new TextEncoder().encode("  \n<svg>"))).toBe("image/svg+xml");
    expect(sniffImageType(new TextEncoder().encode("<?xml version=\"1.0\"?><svg>"))).toBe("image/svg+xml");
  });

  test("rejects an HTML challenge page (the poisoning case)", () => {
    expect(sniffImageType(new TextEncoder().encode("<!DOCTYPE html><html><head><title>Just a moment...</title>"))).toBeNull();
  });

  test("rejects JSON error bodies and empty/short input", () => {
    expect(sniffImageType(new TextEncoder().encode("{\"error\":\"nope\"}"))).toBeNull();
    expect(sniffImageType(bytes())).toBeNull();
    expect(sniffImageType(bytes(0xff))).toBeNull();
  });
});
