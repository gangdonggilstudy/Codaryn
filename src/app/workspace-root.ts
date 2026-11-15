/**
 * The workspace's real path for the commands that read a workspace's records: `codaryn runs`, and the
 * app layer's `workspaceRootOf` (runs, report, revert, changes). S-5 first: a network or device path is
 * refused before the file system is touched; then the real path, which must be a folder.
 *
 * U-315 (the CLI migration's step C-9a, the run list's side): moved from src/cli/runs.ts with its text
 * as it was. The CLI keeps a re-export at the old path (plan A), so the CLI's `runs` and everything that
 * takes the name from there are as before.
 */

import { realpath as realpathCallback } from "node:fs";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { JsonOutcome } from "./command-outcome.js";
import { localPathProblem } from "./input/task.js";
import { cliError } from "./prepare.js";

const realpathNative = promisify(realpathCallback.native);

type Resolved<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: JsonOutcome };

/** The workspace's real path. A network or device path is refused before the file system is touched (S-5). */
export async function resolveWorkspaceRoot(workspace: string, cwd: string): Promise<Resolved<string>> {
  const problem = localPathProblem(workspace, cwd);
  if (problem !== null) return { ok: false, error: cliError("invalid_arguments", `the path given by --workspace ${problem}`) };
  try {
    const root = await realpathNative(path.resolve(cwd, workspace));
    if (!(await lstat(root)).isDirectory()) throw new Error("not a directory");
    return { ok: true, value: root };
  } catch {
    return { ok: false, error: cliError("workspace_not_found", "the workspace is not an existing directory") };
  }
}
