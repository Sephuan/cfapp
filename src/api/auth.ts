// CF web-session flows: session validation, password login, and code
// submission via the CF web form. All of these share the curl bridge and the
// cookie jar so CSRF tokens stay bound to the same session that issued them.
import type { CFConfig } from "../config";
import {
  CookieJar,
  jarFetch,
  loadCodeforcesCookieJar,
  saveCodeforcesCookieJar,
} from "./cookie";
import {
  extractLoggedInHandle,
  isCloudflareChallenge,
  isCodeforcesLoginPage,
  findCsrf,
  diagSnippet,
  extractInputFields,
  cfAuthError,
} from "./html";

export { loadCodeforcesCookieJar, saveCodeforcesCookieJar };

export async function validateCodeforcesSession(
  config: CFConfig,
  jar: CookieJar = loadCodeforcesCookieJar()
): Promise<{ ok: boolean; error?: string; handle?: string }> {
  if (jar.isEmpty()) return { ok: false, error: "No saved Codeforces cookies" };
  try {
    const resp = await jarFetch(jar, "https://codeforces.com/settings/general", {}, config);
    const html = await resp.text();
    if (isCloudflareChallenge(resp.status, html)) {
      return { ok: false, error: cfAuthError(config) };
    }
    if (isCodeforcesLoginPage(resp.url, html)) {
      return { ok: false, error: "Saved Codeforces cookies are not logged in" };
    }
    // Always prefer the handle the page actually identifies us as — config
    // might be stale (user logged into a different account in the webview).
    const detected = extractLoggedInHandle(html);
    if (detected) {
      saveCodeforcesCookieJar(jar, "validated");
      return { ok: true, handle: detected };
    }
    if (config.handle && html.toLowerCase().includes(config.handle.toLowerCase())) {
      saveCodeforcesCookieJar(jar, "validated");
      return { ok: true, handle: config.handle };
    }
    if (/\/logout\b|data-logout/i.test(html)) {
      saveCodeforcesCookieJar(jar, "validated");
      return { ok: true };
    }
    return { ok: false, error: "Could not confirm logged-in Codeforces session" };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// Login via CF web form. This is only a fallback; Cloudflare often blocks
// non browser login, so normal submissions should use saved browser cookies.
export async function login(config: CFConfig, jar?: CookieJar): Promise<{ ok: boolean; error?: string; jar: CookieJar }> {
  const j = jar ?? new CookieJar();
  if (!config.handle || !config.password)
    return { ok: false, error: "handle and password required", jar: j };
  try {
    const enterResp = await jarFetch(j, "https://codeforces.com/enter?back=%2F", {}, config);
    const html = await enterResp.text();
    if (isCloudflareChallenge(enterResp.status, html)) {
      return { ok: false, error: cfAuthError(config), jar: j };
    }
    const csrf = findCsrf(html);
    if (!csrf) {
      return {
        ok: false,
        error: `Could not find CSRF on /enter (status ${enterResp.status}). CF returned: ${diagSnippet(html)}`,
        jar: j,
      };
    }

    const fields = extractInputFields(html);
    const body = new URLSearchParams(fields);
    body.set("csrf_token", csrf);
    body.set("action", "enter");
    body.set("handleOrEmail", config.handle);
    body.set("password", config.password);
    body.set("remember", "on");

    const loginResp = await jarFetch(j, "https://codeforces.com/enter", {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://codeforces.com",
        "Referer": "https://codeforces.com/enter",
      },
    }, config);
    const loginHtml = await loginResp.text();
    if (isCloudflareChallenge(loginResp.status, loginHtml)) {
      return { ok: false, error: cfAuthError(config), jar: j };
    }
    // CF on success redirects to "/" (or the back= target); the homepage shows
    // the handle in the right-hand menu. On failure we stay on /enter and the
    // page contains an error message.
    if (loginResp.url.includes("/enter") || /Invalid handle\/email or password/i.test(loginHtml)) {
      return { ok: false, error: "Login failed: invalid handle or password", jar: j };
    }
    if (loginHtml.includes(config.handle)) {
      saveCodeforcesCookieJar(j, "password-login");
      return { ok: true, jar: j };
    }
    return { ok: false, error: `Login uncertain (status ${loginResp.status}, url ${loginResp.url})`, jar: j };
  } catch (e: any) {
    return { ok: false, error: e.message, jar: j };
  }
}

interface SubmitAttempt {
  message: string;
  authFailed?: boolean;
  persistCookies?: boolean;
}

async function submitWithJar(
  config: CFConfig,
  jar: CookieJar,
  contestId: number,
  problemIndex: string,
  source: string,
  languageId: number
): Promise<SubmitAttempt> {
  const submitUrl = `https://codeforces.com/contest/${contestId}/submit`;
  const submitPage = await jarFetch(jar, submitUrl, {}, config);
  const submitHtml = await submitPage.text();
  if (isCloudflareChallenge(submitPage.status, submitHtml)) {
    return { message: `ERROR: ${cfAuthError(config)}` };
  }
  if (isCodeforcesLoginPage(submitPage.url, submitHtml)) {
    return { message: "ERROR: Saved Codeforces cookies are not logged in", authFailed: true };
  }

  const csrf = findCsrf(submitHtml);
  if (!csrf) {
    return {
      message: `ERROR: Could not find CSRF on submit page (status ${submitPage.status}): ${diagSnippet(submitHtml)}`,
    };
  }

  const fields = extractInputFields(submitHtml);
  const body = new URLSearchParams(fields);
  body.set("csrf_token", csrf);
  body.set("action", "submitSolutionFormSubmitted");
  body.set("submittedProblemIndex", problemIndex);
  body.set("programTypeId", languageId.toString());
  body.set("source", source);
  if (!body.has("sourceFile")) body.set("sourceFile", "");
  body.set("tabSize", "4");

  const resp = await jarFetch(jar, `${submitUrl}?csrf_token=${encodeURIComponent(csrf)}`, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": "https://codeforces.com",
      "Referer": submitUrl,
      "X-Csrf-Token": csrf,
    },
  }, config);
  const respHtml = await resp.text();
  if (isCloudflareChallenge(resp.status, respHtml)) {
    return { message: `ERROR: ${cfAuthError(config)}` };
  }
  if (isCodeforcesLoginPage(resp.url, respHtml)) {
    return { message: "ERROR: Codeforces session expired during submission", authFailed: true };
  }
  if (resp.url.includes("/my")) {
    return {
      message: `OK: Submitted! https://codeforces.com/contest/${contestId}/my`,
      persistCookies: true,
    };
  }
  if (respHtml.includes("You have submitted exactly the same code before"))
    return { message: "ERROR: Duplicate submission", persistCookies: true };
  if (respHtml.includes("You are not allowed"))
    return { message: "ERROR: Not allowed to submit to this contest", persistCookies: true };
  // CF re-renders the submit form with one or more `<span class="error ...">`
  // blocks when validation fails (CSRF mismatch, ftaa/bfaa missing, source
  // length, language constraint, etc.). Grab every error span on the page.
  const errors: string[] = [];
  for (const m of respHtml.matchAll(/<span[^>]*class=["'][^"']*\berror\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)) {
    const text = m[1]!.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (text) errors.push(text);
  }
  if (errors.length > 0) {
    return { message: `ERROR: CF rejected submission — ${errors.join(" | ")}`, persistCookies: true };
  }
  return {
    message: `ERROR: Submission may have failed (status ${resp.status}, ended at ${resp.url}). CF returned: ${diagSnippet(respHtml)}`,
    persistCookies: true,
  };
}

// Submit code via CF web form
export async function submitCode(
  config: CFConfig,
  contestId: number,
  problemIndex: string,
  source: string,
  languageId: number
): Promise<string> {
  try {
    const savedJar = loadCodeforcesCookieJar();
    if (!savedJar.isEmpty()) {
      const savedAttempt = await submitWithJar(config, savedJar, contestId, problemIndex, source, languageId);
      if (savedAttempt.persistCookies) saveCodeforcesCookieJar(savedJar, "submit");
      if (!savedAttempt.authFailed) return savedAttempt.message;
    }

    const { CODEFORCES_COOKIE_FILE } = await import("./cookie");
    if (!config.handle || !config.password) {
      return `ERROR: Not authenticated. Run \`bun run auth\` once, or set handle/password and retry. Cookie file: ${CODEFORCES_COOKIE_FILE}`;
    }

    const loginJar = new CookieJar();
    const lr = await login(config, loginJar);
    if (!lr.ok) return `ERROR: ${lr.error}`;

    const loginAttempt = await submitWithJar(config, loginJar, contestId, problemIndex, source, languageId);
    if (loginAttempt.persistCookies) saveCodeforcesCookieJar(loginJar, "submit");
    return loginAttempt.message;
  } catch (e: any) {
    return `ERROR: ${e.message}`;
  }
}
