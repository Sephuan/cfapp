// Regression tests for extractLoggedInHandle — the function that decides which
// CF account the saved cookies belong to. Getting this wrong is scary: the app
// showed a stranger's profile (a Legendary GM who happened to appear in the
// /settings/general streams sidebar) instead of the real logged-in user,
// because the old logic picked the most-frequent /profile/ link. The real
// signal is CF's inline `var handle = "..."` bootstrap; these tests pin that.
import { test, expect, describe } from "bun:test";
import { extractLoggedInHandle } from "./api/html";

describe("extractLoggedInHandle", () => {
  test("reads the inline `var handle` bootstrap", () => {
    const html = `<script>Codeforces.ping("/data/update-online"); var handle = "huanjiu162";</script>`;
    expect(extractLoggedInHandle(html)).toBe("huanjiu162");
  });

  test("inline handle beats a more-frequent stranger profile link", () => {
    // The exact shape of the bug: maroonrk appears 3× in the streams sidebar /
    // ratings table, the viewer's own /profile link only twice — but the
    // inline bootstrap is authoritative.
    const html = `
      <script>var handle = "huanjiu162";</script>
      <a href="/profile/maroonrk">By maroonrk</a>
      <a href="/profile/maroonrk">maroonrk</a>
      <a href="/profile/maroonrk">maroonrk</a>
      <a href="/profile/huanjiu162">huanjiu162</a>
      <a href="/profile/huanjiu162">huanjiu162</a>`;
    expect(extractLoggedInHandle(html)).toBe("huanjiu162");
  });

  test("tolerates single quotes and loose whitespace", () => {
    expect(extractLoggedInHandle(`var   handle='Some_User-1';`)).toBe("Some_User-1");
  });

  test("falls back to profile-link frequency when no bootstrap present", () => {
    const html = `<a href="/profile/alice">a</a><a href="/profile/alice">a</a><a href="/profile/bob">b</a>`;
    expect(extractLoggedInHandle(html)).toBe("alice");
  });

  test("empty inline handle (logged out) does not misfire on sidebar links", () => {
    const html = `var handle = ""; <a href="/profile/maroonrk">maroonrk</a>`;
    // Empty bootstrap is ignored; the only profile link is a stranger's, so the
    // fallback returns it — but with no logged-in cookies this path is never
    // reached in practice (validateCodeforcesSession gates on login first).
    // What matters: an empty `var handle` must NOT be returned as the handle.
    expect(extractLoggedInHandle(html)).not.toBe("");
  });

  test("returns null when there is nothing to go on", () => {
    expect(extractLoggedInHandle(`<html><body>no handle here</body></html>`)).toBeNull();
  });
});
