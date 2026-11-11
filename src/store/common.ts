/** Helpers shared by the journal, the lock and the change snapshots. Not exported from index.ts. */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { RUNS_DIR_NAME, STATE_DIR_NAME } from "../contracts/index.js";

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function assertRunId(runId: string): void {
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId) || runId.includes("..")) {
    throw new TypeError("runId must be 1-128 characters of [A-Za-z0-9._-] and must not contain '..'");
  }
}

export function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

/** Creates the state directory and keeps its content out of version control tools. */
export async function ensureStateDir(workspaceRoot: string): Promise<string> {
  const stateDir = join(workspaceRoot, STATE_DIR_NAME);
  await mkdir(stateDir, { recursive: true });
  try {
    await writeFile(join(stateDir, ".gitignore"), "*\n", { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
  return stateDir;
}

export function runDir(workspaceRoot: string, runId: string): string {
  return join(workspaceRoot, STATE_DIR_NAME, RUNS_DIR_NAME, runId);
}
