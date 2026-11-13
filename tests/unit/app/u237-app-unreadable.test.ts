/**
 * Unit U-237 (p4g's R-108 H-2, with na-core's U-210): a run through the app gets the run's unreadable
 * paths and k in every part that judges or reads, as the CLI's run does.
 * The app kept its own run assembly (src/app/assemble.ts). It made the gate from the task's own policy
 * only, and the tool runner, the verifier runner and the integrity checks without the run's list and
 * k. With U-210 the parser takes `unreadablePaths` (every source's united: the config file, the
 * profile, the definition, the task) and the CLI's assembly hands them to each part from one place
 * (runGuards). Through the app, a list in the config file did not bind the gate, so a read under it
 * was allowed; a search listed the private table's lines, and query_table showed groups of fewer
 * than k rows. Now the app's assembly is the CLI's (createAssemble with the app's hooks).
 * The workspace is the private canary of tests/fixtures/private-tables.ts; the findings come from
 * tests/support/private-canary.ts (the scripted model's channel and every record). Reproduced first
 * (e80bdfa, todo until the app's runs were assembled by the CLI). Temporary folders, scripted model, fake values only.
 */

import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import type { RunHandle } from "../../../src/app/index.js";
import type { JournalRecord } from "../../../src/contracts/index.js";
import type { Sandbox } from "../../fixtures/builders.js";
import { writePrivateWorkspace } from "../../fixtures/private-tables.js";
import type { PrivateCanary } from "../../fixtures/private-tables.js";
import { describeFindings, findCanary, leaksOf, recordSources, scriptedModelSources } from "../../support/private-canary.js";
import { appEnvironment, readJournal, setupRun, taskRequest } from "./support.js";

const TOOLS = ["read_file", "search_files", "query_table", "write_file"];
/** A whole policy (a config file's policy is one), with the private folder unreadable. */
const PRIVATE_POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, unreadablePaths: ["private"] };

/** The private workspace under base/work, written before the steps that name its markers. */
async function privateRun(where: "config" | "task", steps: (canary: PrivateCanary) => readonly unknown[]) {
  const base = await setupRun({}, { workflowRef: "analyze", tools: TOOLS, ...(where === "task" ? { policy: PRIVATE_POLICY } : {}) }, []);
  const work = path.join(base, "work");
  const canary = writePrivateWorkspace({ workspace: work } as unknown as Sandbox);
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps: [...steps(canary), { text: "done" }] }), "utf8");
  const config = path.join(base, "config.json");
  await writeFile(config, JSON.stringify({ schemaVersion: 1, ...(where === "config" ? { policy: PRIVATE_POLICY } : {}) }), "utf8");
  const app = createCodarynApp(await appEnvironment(base));
  const started = await app.startRun(taskRequest(base, { configPath: config }));
  assert.ok(started.ok, JSON.stringify(started));
  const handle = (started as { handle: RunHandle }).handle;
  const done = await handle.done;
  assert.ok(done.ok, JSON.stringify(done));
  return { base, work, canary, journal: await readJournal(base, handle.runId) };
}

/** The decisions on the run's tool calls, by tool: allowed, and the code when refused. */
const decisions = (journal: readonly JournalRecord[], tool: string): { allowed: unknown; code: unknown }[] =>
  journal
    .filter((record) => record.type === "tool_decision" && (record as unknown as { tool?: string }).tool === tool)
    .map((record) => ({ allowed: (record as unknown as { allowed?: unknown }).allowed, code: (record as unknown as { code?: unknown }).code }));

/** What the run let out of the private folder: rows, names and small groups' keys, to the model or in a record. */
const leaks = (work: string, canary: PrivateCanary) => leaksOf(findCanary([...scriptedModelSources(work), ...recordSources(work)], canary));

describe("U-237, R-108 H-2: a run through the app and the run's unreadable paths", () => {
  test("a list in the config file: the read under it is refused, the search and query_table leave it out, no marker in the records", async () => {
    const run = await privateRun("config", (canary) => {
      const csv = canary.tables.find((file) => file.format === "csv")!;
      return [
        { toolCalls: [{ name: "read_file", args: { path: csv.path } }] },
        // A key many rows share: a line found by it would carry that row's markers.
        { toolCalls: [{ name: "search_files", args: { path: ".", text: canary.largeKeys[0] } }] },
        { toolCalls: [{ name: "query_table", args: { path: csv.path, groupBy: ["region"], operations: [{ op: "count", column: "person" }] } }] },
      ];
    });
    assert.deepEqual(decisions(run.journal, "read_file"), [{ allowed: false, code: "unreadable_path" }]);
    const found = leaks(run.work, run.canary);
    assert.deepEqual(found, [], describeFindings(found));
  });

  test("a list in the task file: the search leaves it out, no marker in the records", async () => {
    const run = await privateRun("task", (canary) => [{ toolCalls: [{ name: "search_files", args: { path: ".", text: canary.largeKeys[0] } }] }]);
    const found = leaks(run.work, run.canary);
    assert.deepEqual(found, [], describeFindings(found));
  });
});
