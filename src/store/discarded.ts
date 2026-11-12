/**
 * G-E, DR-9: the discarded directory of an apply run, `<root>/.codaryn/discarded/<apply runId>/`.
 * A `discard` action moves a file here under a name built from its action index (the executor,
 * G-C); a revert moves it back. It lies outside the run directories, so deleting a run's records
 * never deletes these files. It is inside the state directory, so file tools cannot reach it; a
 * command the policy allows runs with the user's rights and can (T-11).
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { DISCARDED_DIR_NAME, STATE_DIR_NAME } from "../contracts/index.js";
import { assertRunId, ensureStateDir, isPlainDirectory } from "./common.js";
import type { RunWriteNotes } from "./run-writes.js";

/** The directory's absolute path (whether or not it exists). */
export function discardedRootPath(workspaceRoot: string, runId: string): string {
  assertRunId(runId);
  return join(workspaceRoot, STATE_DIR_NAME, DISCARDED_DIR_NAME, runId);
}

/**
 * Creates the directory when missing and returns its path, for `ApplyDeps.discardedRoot`.
 * `workspaceRoot` is the real path of the root. Rejects when `discarded` or the run's directory is
 * a link or not a directory, so a discarded file never lands outside the workspace's own state.
 */
export async function prepareDiscardedRoot(workspaceRoot: string, runId: string): Promise<string> {
  return prepareDiscardedRootWith(workspaceRoot, runId);
}

/** DR-38: prepareDiscardedRoot that notes the directories it makes (createApplyRecorders). */
export async function prepareDiscardedRootWith(workspaceRoot: string, runId: string, notes?: RunWriteNotes): Promise<string> {
  const dir = discardedRootPath(workspaceRoot, runId);
  const parent = join(workspaceRoot, STATE_DIR_NAME, DISCARDED_DIR_NAME);
  await ensureStateDir(workspaceRoot);
  await mkdir(parent, { recursive: true }).catch(() => undefined);
  if (!(await isPlainDirectory(parent))) throw new Error("the discarded directory is a link or not a directory; nothing was created");
  await mkdir(dir, { recursive: true });
  if (!(await isPlainDirectory(dir))) throw new Error("the run's discarded directory is a link or not a directory");
  if (notes !== undefined) await notes.dir(dir);
  return dir;
}
