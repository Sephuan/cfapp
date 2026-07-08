import { mkdirSync, cpSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "dist-web");

mkdirSync(OUT, { recursive: true });

const result = await Bun.build({
  entrypoints: [join(ROOT, "src/web/app.tsx")],
  outdir: OUT,
  minify: true,
  target: "browser",
});

if (!result.success) {
  console.error("Build failed:", result.logs);
  process.exit(1);
}

mkdirSync(join(OUT, "styles"), { recursive: true });
for (const css of ["themes.css", "base.css", "problem.css", "settings.css", "stats.css"]) {
  cpSync(join(ROOT, "src/web/styles", css), join(OUT, "styles", css));
}

// Derive the shipped index.html from the real source (src/web/index.html) so
// the no-flash boot script — theme + font-role allow-lists — never drifts from
// dev. Bun's HTML bundler isn't used here (app.tsx is built above as /app.js),
// so we just rewrite the two dev-relative paths to their served locations:
//   ./styles/*  -> /styles/*   (copied above)
//   ./app.tsx   -> /app.js     (the bundled entry)
const html = readFileSync(join(ROOT, "src/web/index.html"), "utf8")
  .replaceAll('"./styles/', '"/styles/')
  .replace('"./app.tsx"', '"/app.js"');

writeFileSync(join(OUT, "index.html"), html);
console.log("Web build complete → dist-web/");
