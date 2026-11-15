/**
 * Unit U-237, Codex V-24 (on eb72ba9), with main's GUI run plans (U-218, U-229) and U-210's tip:
 * - M-3: that hash's app could not carry a run plan out (the app's applyPlan path came with U-218).
 *   Now it can; here a run plan carried out through the app keeps the run's unreadable paths: the
 *   carrying run's read under them is refused as unreadable_path, its search leaves them out, and
 *   nothing of the private file reaches the model, a record or the run's events. The list comes from
 *   the config file's own policy or from a profile the form names (the sources the app once missed).
 * - M-2: the changes view gives a file's earlier text although its folder became unreadable after the
 *   run. PM's decision: unreadable paths keep things from the model; the changes view and the file
 *   view are a person's look at their own files, so they stay open (the masking rules as always).
 *   Here it is pinned that this text has no way into a model request or a run's records: the view
 *   writes nothing, and a later run can read neither the file nor the run's kept original (the
 *   state folder) and sends nothing of it.
 * The private text is a synthetic marker; the findings come from tests/support/private-canary.ts
 * (the scripted model's channel and every record but change snapshots). Temporary folders, scripted
 * model, fake values only.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import type { ChangesOutput, RunEvent, RunHandle } from "../../../src/app/index.js";
import type { EngineResult, JournalRecord } from "../../../src/contracts/index.js";
import { describeFindings, findCanary, recordSources, scriptedModelSources } from "../../support/private-canary.js";
import type { ChannelSource } from "../../support/private-canary.js";
import { appEnvironment, readJournal, setupRun, taskForm, taskRequest } from "./support.js";

/** The private file's marker (synthetic, built from parts). */
const MARK = ["u237", "private", "line", "q7Zk"].join("-");
const PRIVATE_POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, unreadablePaths: ["private"] };
const REWRITE = { tools: ["read_file", "search_files", "write_file", "propose_changes"], plan: "run" };
const sha = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

type Source = "config" | "profile";
const listed = (source: Source, more: Record<string, unknown> = {}) =>
  source === "config" ? { schemaVersion: 1, policy: PRIVATE_POLICY, ...more } : { schemaVersion: 1, profiles: { private: { policy: PRIVATE_POLICY } }, ...more };
const profileOf = (source: Source) => (source === "profile" ? { profile: "private" } : {});

const decisions = (journal: readonly JournalRecord[], tool: string): { allowed: unknown; code: unknown }[] =>
  journal
    .filter((record) => record.type === "tool_decision" && (record as unknown as { tool?: string }).tool === tool)
    .map((record) => ({ allowed: (record as unknown as { allowed?: unknown }).allowed, code: (record as unknown as { code?: unknown }).code }));
/** Where MARK is found: the model's channel and every record but snapshots, and any text given. */
const marked = (work: string, more: readonly ChannelSource[] = []) => findCanary([...scriptedModelSources(work), ...recordSources(work), ...more], { row: [MARK] });

describe("U-237, V-24 M-3: a run plan carried out through the app keeps the run's unreadable paths", () => {
  for (const source of ["config", "profile"] as const) {
    test(`the list in the ${source}: the carrying run's read is refused, its search leaves it out, nothing of it goes out`, async () => {
      const propose = { toolCalls: [{ name: "propose_changes", args: { summary: "add the notes", files: [{ path: "docs/notes.md", change: "create" }] } }] };
      const base = await setupRun({ "private/secret.txt": `secret line ${MARK}\n`, "docs/guide.md": "# Guide\n" }, { workflowRef: "rewrite" }, [propose, { text: "planned" }]);
      const work = path.join(base, "work");
      const config = path.join(base, "config.json");
      await writeFile(config, JSON.stringify(listed(source, { workflows: { rewrite: REWRITE } })), "utf8");
      const app = createCodarynApp(await appEnvironment(base));
      const started = await app.startRun(taskRequest(base, { configPath: config, ...profileOf(source) }));
      assert.ok(started.ok, JSON.stringify(started));
      const planned = await started.handle.done;
      assert.ok(planned.ok, JSON.stringify(planned));
      const plan = planned.result.plan as { digest: string; kind?: string } | undefined;
      assert.deepEqual([planned.result.reason, plan?.kind], ["plan_pending", "changes"], JSON.stringify(planned.result));

      // The carrying run: a read under the list, a search that would find the private line, the planned write.
      await writeFile(
        path.join(base, "script.json"),
        JSON.stringify({
          schemaVersion: 1,
          steps: [
            { toolCalls: [{ name: "read_file", args: { path: "private/secret.txt" } }] },
            { toolCalls: [{ name: "search_files", args: { path: ".", text: "secret line" } }] },
            { toolCalls: [{ name: "write_file", args: { path: "docs/notes.md", expectedHash: null, change: { kind: "replace_all", content: "# Notes\n" } } }] },
            { text: "done" },
          ],
        }),
        "utf8",
      );
      const events: RunEvent[] = [];
      const applied = await app.applyPlan(
        { settings: taskForm(base, { configPath: config, ...profileOf(source) }), planRunId: planned.result.runId, digest: plan!.digest, cancelFile: null, unsafeMoveConsent: null },
        { onRunEvent: (event: RunEvent) => events.push(event) } as never,
      );
      assert.ok(applied.ok, JSON.stringify(applied));
      const done = (await applied.handle.done) as unknown as { ok: boolean; output: EngineResult & { planRunId?: string } };
      assert.ok(done.ok, JSON.stringify(done));
      assert.deepEqual([done.output.kind, done.output.planRunId], ["run", planned.result.runId]);
      assert.equal(await readFile(path.join(work, "docs", "notes.md"), "utf8"), "# Notes\n", "the planned write is made");

      const journal = await readJournal(base, applied.handle.runId);
      assert.deepEqual(decisions(journal, "read_file"), [{ allowed: false, code: "unreadable_path" }]);
      const found = marked(work, [{ channel: "output", label: "the carrying run's events", text: JSON.stringify(events) }]);
      assert.deepEqual(found, [], describeFindings(found));
    });
  }
});

describe("U-237, V-24 M-2: a file whose folder became unreadable after the run, in the changes view", () => {
  test("the person's view gives its earlier text (PM); nothing of it gets into a record or a later run's model requests", async () => {
    const original = `${MARK}\n`;
    const replace = { toolCalls: [{ name: "write_file", args: { path: "private/secret.txt", expectedHash: sha(original), change: { kind: "replace_all", content: "public text\n" } } }] };
    const base = await setupRun({ "private/secret.txt": original }, {}, [replace, { text: "done" }]);
    const work = path.join(base, "work");
    const app = createCodarynApp(await appEnvironment(base));
    const first = await app.startRun(taskRequest(base));
    assert.ok(first.ok, JSON.stringify(first));
    const firstHandle = (first as { handle: RunHandle }).handle;
    assert.ok((await firstHandle.done).ok);
    assert.deepEqual(marked(work), [], "the run wrote the file without reading it: no record holds the earlier text");

    // Afterwards the folder becomes unreadable.
    const config = path.join(base, "config.json");
    await writeFile(config, JSON.stringify(listed("config")), "utf8");
    const view = await app.changes({ settings: taskForm(base, { configPath: config }), runId: firstHandle.runId });
    assert.ok(view.ok, JSON.stringify(view));
    const files = (view as { output: ChangesOutput }).output.files;
    assert.deepEqual(files.map((file) => [file.path, file.state]), [["private/secret.txt", "as_run_left"]]);
    assert.equal(files[0]?.before, original, "the person's own file, shown to the person (PM's decision)");
    assert.deepEqual(marked(work), [], "the view writes nothing");

    // A later run tries the file and the run's kept original in the state folder.
    const snapshots = path.join(work, ".codaryn", "runs", firstHandle.runId, "snapshots");
    const kept = readdirSync(snapshots, { recursive: true, withFileTypes: true }).find((entry) => entry.isFile());
    assert.ok(kept !== undefined, "the run kept the original");
    const keptPath = path.relative(work, path.join(kept.parentPath, kept.name)).split(path.sep).join("/");
    await writeFile(
      path.join(base, "script.json"),
      JSON.stringify({ schemaVersion: 1, steps: [{ toolCalls: [{ name: "read_file", args: { path: "private/secret.txt" } }] }, { toolCalls: [{ name: "read_file", args: { path: keptPath } }] }, { text: "done" }] }),
      "utf8",
    );
    const second = await app.startRun(taskRequest(base, { configPath: config }));
    assert.ok(second.ok, JSON.stringify(second));
    const secondHandle = (second as { handle: RunHandle }).handle;
    assert.ok((await secondHandle.done).ok);
    const reads = decisions(await readJournal(base, secondHandle.runId), "read_file");
    assert.deepEqual(reads.map((read) => read.allowed), [false, false], JSON.stringify(reads));
    assert.equal(reads[0]?.code, "unreadable_path");
    const found = marked(work);
    assert.deepEqual(found, [], describeFindings(found));
  });
});
