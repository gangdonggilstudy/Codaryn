/**
 * GU-3 (3.7): writing a saved report to the file the person chose in the main process's OS save
 * dialog. Written through a temporary file next to it and a rename, so the file is never seen half
 * written; an old file of that name is replaced only by a complete one. No Electron, so this is
 * tested under Node.
 */

import { randomBytes } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";

export async function writeTextFile(path: string, text: string): Promise<void> {
  const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, text, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** The file name a saved report is offered under: the run id only, no workspace or goal. */
export function reportFileName(runId: string): string {
  return `codaryn-report-${runId}.md`;
}

/**
 * The OS save dialog's options for a report: the offered file, the Markdown filter, and (R38-L-1)
 * the question before an existing file is replaced, which Linux asks only when told to (Windows and
 * macOS always ask).
 */
export function saveDialogOptions(defaultPath: string): { readonly defaultPath: string; readonly filters: { name: string; extensions: string[] }[]; readonly properties?: "showOverwriteConfirmation"[] } {
  return { defaultPath, filters: [{ name: "Markdown", extensions: ["md"] }], properties: ["showOverwriteConfirmation"] };
}
