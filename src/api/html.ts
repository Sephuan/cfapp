// HTML helpers (entity decoding, tag stripping, attribute extraction, CSRF
// and login-state detection) plus the KaTeX math renderer that powers
// problem-statement and translation rendering.
//
// Implementation is split under ./html-parts/ for maintainability; this file
// re-exports the public API so existing imports from "./html" keep working.
export {
  decodeEntities,
  htmlAttr,
  stripTags,
  cleanText,
} from "./html-parts/text";
export {
  locateClassDiv,
  plainText,
  diagSnippet,
  isCloudflareChallenge,
  isCodeforcesLoginPage,
  findCsrf,
  extractInputFields,
  cfAuthError,
  extractLoggedInHandle,
} from "./html-parts/page-detect";
export {
  renderMathInHtml,
  normalizeFootnoteTex,
  __mathTestInternals,
} from "./html-parts/math";
export {
  parseStatementToJSON,
  parseStatementHtml,
} from "./html-parts/statement";
// Legacy re-exports kept for API parity with the pre-split html.ts.
export { withNetworkOptions } from "./net";
export type { CFConfig } from "../config";
