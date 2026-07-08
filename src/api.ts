// Backwards-compatibility shim. The CF API layer now lives under src/api/
// (see ./api/index.ts for the full module map). This file just re-exports
// everything so existing `import { ... } from "./api"` paths — including the
// legacy terminal UI (tsconfig.tui.json) and the math regression tests
// (which read `__mathTestInternals`) — keep compiling without changes.
export * from "./api/index";
