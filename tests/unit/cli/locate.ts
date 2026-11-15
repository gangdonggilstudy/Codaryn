/**
 * Stand-ins shared by CLI unit tests.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceLocation } from "../../../src/cli/security/index.js";

/**
 * Lexical stand-in for `locateInWorkspace` (S-1) in tests whose files exist only in memory.
 * Tests on real directories use the real function.
 */
export async function lexicalLocate(file: string, workspaceRoot: string): Promise<WorkspaceLocation> {
  const relative = path.relative(path.resolve(workspaceRoot), path.resolve(file));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)) ? "inside" : "outside";
}

/**
 * The journal and result.json of every run in `<workspace>/.codaryn/runs/`. Snapshots
 * (`snapshots/`) are left out: they are raw originals by design (R-8).
 */
export async function recordedText(workspace: string): Promise<string> {
  const runs = path.join(workspace, ".codaryn", "runs");
  let text = "";
  for (const runId of await readdir(runs)) {
    for (const entry of await readdir(path.join(runs, runId), { withFileTypes: true })) {
      if (entry.isFile()) text += await readFile(path.join(runs, runId, entry.name), "utf8");
    }
  }
  return text;
}
