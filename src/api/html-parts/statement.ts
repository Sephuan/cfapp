// Parse CF problem-statement HTML into structured JSON / plain text.
import type { StatementJSON } from "../types";
import { decodeEntities, stripTags, cleanText } from "./text";
import { plainText, locateClassDiv } from "./page-detect";
import { renderMathInHtml } from "./math";

function extractSamples(sampleTestsInner: string): { input: string; output: string }[] {
  const pres = [...sampleTestsInner.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/g)].map(m => m[1] ?? "");
  const formatPre = (s: string): string => {
    let t = s.replace(/<br\s*\/?>/gi, "\n");
    t = t.replace(/<div[^>]*>/gi, "").replace(/<\/div>/gi, "\n");
    t = t.replace(/<[^>]+>/g, "");
    t = decodeEntities(t);
    return t.replace(/\n{2,}/g, "\n").replace(/^\n+|\n+$/g, "");
  };
  const out: { input: string; output: string }[] = [];
  for (let i = 0; i < pres.length; i += 2) {
    out.push({ input: formatPre(pres[i] ?? ""), output: formatPre(pres[i + 1] ?? "") });
  }
  return out;
}

export function parseStatementToJSON(html: string): StatementJSON {
  let content = "";
  const startIndex = html.indexOf('class="problem-statement"');
  if (startIndex !== -1) {
    const divStart = html.lastIndexOf("<div", startIndex);
    if (divStart !== -1) {
      const tagOpenEnd = html.indexOf(">", divStart) + 1;
      let depth = 1, j = tagOpenEnd;
      while (j < html.length && depth > 0) {
        if (html.startsWith("<div", j)) { depth++; j += 4; }
        else if (html.startsWith("</div>", j)) {
          depth--;
          if (depth === 0) { content = html.substring(tagOpenEnd, j); break; }
          j += 6;
        } else j++;
      }
    }
  }

  const header = locateClassDiv(content, "header");
  const inputSpec = locateClassDiv(content, "input-specification");
  const outputSpec = locateClassDiv(content, "output-specification");
  const sampleTests = locateClassDiv(content, "sample-tests");
  const note = locateClassDiv(content, "note");

  const headerInner = header ? content.substring(header.innerStart, header.innerEnd) : "";
  const titleDiv = locateClassDiv(headerInner, "title");
  const timeLimitDiv = locateClassDiv(headerInner, "time-limit");
  const memLimitDiv = locateClassDiv(headerInner, "memory-limit");
  const title = titleDiv
    ? plainText(headerInner.substring(titleDiv.innerStart, titleDiv.innerEnd))
    : "";
  const timeRaw = timeLimitDiv
    ? plainText(headerInner.substring(timeLimitDiv.innerStart, timeLimitDiv.innerEnd))
    : "";
  const memRaw = memLimitDiv
    ? plainText(headerInner.substring(memLimitDiv.innerStart, memLimitDiv.innerEnd))
    : "";
  const timeLimit = timeRaw.replace(/^time limit per test\s*/i, "");
  const memoryLimit = memRaw.replace(/^memory limit per test\s*/i, "");

  const bodyEnd = Math.min(
    inputSpec?.start ?? Infinity,
    outputSpec?.start ?? Infinity,
    sampleTests?.start ?? Infinity,
    note?.start ?? Infinity,
    content.length
  );
  const bodyStart = header?.end ?? 0;
  const statementRaw = bodyEnd > bodyStart ? content.substring(bodyStart, bodyEnd) : "";

  const stripSectionTitle = (inner: string) =>
    inner.replace(/<div[^>]*class="[^"]*\bsection-title\b[^"]*"[^>]*>[\s\S]*?<\/div>/, "");

  const statementHtml = renderMathInHtml(statementRaw);
  const inputHtml = inputSpec
    ? renderMathInHtml(stripSectionTitle(content.substring(inputSpec.innerStart, inputSpec.innerEnd)))
    : "";
  const outputHtml = outputSpec
    ? renderMathInHtml(stripSectionTitle(content.substring(outputSpec.innerStart, outputSpec.innerEnd)))
    : "";
  const samples = sampleTests
    ? extractSamples(content.substring(sampleTests.innerStart, sampleTests.innerEnd))
    : [];
  const noteHtml = note
    ? renderMathInHtml(stripSectionTitle(content.substring(note.innerStart, note.innerEnd)))
    : "";

  return { title, timeLimit, memoryLimit, statementHtml, inputHtml, outputHtml, samples, noteHtml };
}

// Legacy markdown statement parser, retained for the terminal UI. Kept verbatim
// so the TUI output is byte-identical to before the refactor.
export function parseStatementHtml(html: string): string {
  const parts: string[] = [];

  let content = html;

  const startIndex = html.indexOf('class="problem-statement"');
  if (startIndex !== -1) {
    const divStart = html.lastIndexOf('<div', startIndex);
    if (divStart !== -1) {
      const remaining = html.substring(divStart);
      let depth = 1;
      let i = 5;
      while (i < remaining.length && depth > 0) {
        if (remaining.substring(i, i + 6) === '</div>') {
          depth--;
          if (depth === 0) {
            content = remaining.substring(5, i);
            break;
          }
          i += 6;
        } else if (remaining.substring(i, i + 4) === '<div') {
          depth++;
          i += 4;
        } else {
          i++;
        }
      }
    }
  }

  const titleMatch = content.match(/<div[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  if (!titleMatch) {
    const h1Match = content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    if (h1Match) {
      parts.push(`# ${stripTags(h1Match[1]!).trim()}`);
    }
  } else {
    const title = stripTags(titleMatch[1]!).trim();
    if (title && !title.includes("Problem")) {
      parts.push(`# ${title}`);
    }
  }

  const timeMatch = content.match(/<div[^>]*class="[^"]*time-limit[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  const memMatch = content.match(/<div[^>]*class="[^"]*memory-limit[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  const limits: string[] = [];
  if (timeMatch) limits.push(stripTags(timeMatch[1]!).trim());
  if (memMatch) limits.push(stripTags(memMatch[1]!).trim());
  if (limits.length) {
    parts.push("");
    parts.push(`*${limits.join(" · ")}*`);
    parts.push("");
  }

  const paragraphs = content.match(/<p[^>]*>([\s\S]*?)<\/p>/g) || [];
  if (paragraphs.length > 0) {
    parts.push(cleanText(paragraphs.join("\n\n")));
  }

  const sampleTestsMatch = html.match(/<div[^>]*class="[^"]*\bsample-tests\b[^"]*"[^>]*>([\s\S]*)/);
  let sampleSection = sampleTestsMatch ? sampleTestsMatch[1] : "";
  if (sampleSection) {
    let depth = 1;
    let i = 0;
    while (i < sampleSection.length && depth > 0) {
      if (sampleSection.startsWith("<div", i)) { depth++; i += 4; }
      else if (sampleSection.startsWith("</div>", i)) { depth--; if (depth === 0) { sampleSection = sampleSection.slice(0, i); break; } i += 6; }
      else i++;
    }
  }
  const preBlocks = [...(sampleSection ?? "").matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/g)].map(m => m[1]);
  const sampleCount = Math.ceil(preBlocks.length / 2);

  const formatPre = (innerPre: string): string => {
    let t = innerPre.replace(/<br\s*\/?>/gi, "\n");
    t = t.replace(/<div[^>]*>/gi, "").replace(/<\/div>/gi, "\n");
    t = stripTags(t);
    return t.replace(/\n{2,}/g, "\n").trim();
  };

  for (let i = 0; i < sampleCount; i++) {
    parts.push("");
    parts.push(`### Example ${i + 1}`);
    const inBlock = preBlocks[i * 2];
    const inText = inBlock ? formatPre(inBlock) : "";
    if (inText) {
      parts.push("");
      parts.push("**Input**");
      parts.push("```");
      parts.push(inText);
      parts.push("```");
    }
    const outBlock = preBlocks[i * 2 + 1];
    const outText = outBlock ? formatPre(outBlock) : "";
    if (outText) {
      parts.push("");
      parts.push("**Output**");
      parts.push("```");
      parts.push(outText);
      parts.push("```");
    }
  }

  const noteMatch = content.match(/<div[^>]*class="[^"]*note[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  if (noteMatch) {
    parts.push("");
    parts.push("## Note");
    parts.push(cleanText(noteMatch[1]!));
  }

  const result = parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  if (!result) {
    const cleanContent = cleanText(content);
    const lines = cleanContent.split("\n").filter(line => line.trim().length > 10);
    if (lines.length > 0) {
      return lines.slice(0, 30).join("\n");
    }
    return "Could not parse statement.";
  }

  return result;
}

