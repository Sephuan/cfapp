// Barrel re-export for the Codeforces API layer. The original api.ts was a
// single 1683-line file; it's now split into focused modules under src/api/:
//   types.ts  — shared interfaces
//   net.ts    — base URLs, UA, withNetworkOptions
//   cache.ts  — two-tier cache + stale-while-revalidate
//   cookie.ts — CookieJar + curl bridge (Cloudflare JA3 bypass)
//   html.ts   — HTML helpers + KaTeX math renderer (problem statements)
//   cf-api.ts — CF REST API wrappers (contests, problems, submissions, users)
//   auth.ts   — session validation, login, code submission
//
// Everything is re-exported here so callers that wrote `import { X } from
// "../api"` keep compiling unchanged.
export * from "./types";
export * from "./net";
export * from "./cache";
export { CookieJar, jarFetch, jarFetchViaCurl, withNetworkOptions } from "./cookie";
export type { BunFetchInit } from "./cookie";
export {
  CODEFORCES_COOKIE_FILE,
  loadCodeforcesCookieJar,
  saveCodeforcesCookieJar,
  saveCodeforcesCookieHeader,
  saveCodeforcesCookies,
} from "./cookie";
export {
  decodeEntities,
  htmlAttr,
  stripTags,
  cleanText,
  locateClassDiv,
  plainText,
  diagSnippet,
  isCloudflareChallenge,
  isCodeforcesLoginPage,
  findCsrf,
  extractInputFields,
  cfAuthError,
  extractLoggedInHandle,
  renderMathInHtml,
  normalizeFootnoteTex,
  parseStatementToJSON,
  parseStatementHtml,
  __mathTestInternals,
} from "./html";
export {
  cfGet,
  getContests,
  getContestProblems,
  getStandings,
  getContestSubmissions,
  getMyContestStatus,
  scrapeMyContestStatus,
  getAllProblemRatings,
  getProblemStatementStructured,
  ratingTier,
  getUserInfo,
  getUserStatus,
  getUserRatingHistory,
} from "./cf-api";
export {
  validateCodeforcesSession,
  login,
  submitCode,
} from "./auth";

// Static language list for the submit form.
export const LANGUAGES: { name: string; id: number }[] = [
  { name: "C++20 (GNU G++20 13.2)", id: 89 },
  { name: "C++23 (GNU G++23 14.2)", id: 91 },
  { name: "C++17 (GNU G++17 7.3)", id: 54 },
  { name: "Python 3.13", id: 31 },
  { name: "PyPy 3.10", id: 70 },
  { name: "Java 21", id: 87 },
  { name: "Rust 2024", id: 98 },
  { name: "Rust 2021", id: 75 },
  { name: "Go 1.22", id: 32 },
];
