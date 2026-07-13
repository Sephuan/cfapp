import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { configDir } from "../paths";

const DRAFT_DIR = join(configDir(), "drafts");

function draftPath(contestId: string, index: string): string {
  return join(DRAFT_DIR, `${contestId}${index}.txt`);
}

export function loadDraft(contestId: string, index: string): string {
  try {
    const p = draftPath(contestId, index);
    if (existsSync(p)) return readFileSync(p, "utf-8");
  } catch {}
  return "";
}

export function saveDraft(contestId: string, index: string, code: string): void {
  try {
    if (!existsSync(DRAFT_DIR)) mkdirSync(DRAFT_DIR, { recursive: true });
    writeFileSync(draftPath(contestId, index), code);
  } catch (e: any) {
    throw new Error(`Failed to save draft: ${e.message}`);
  }
}
