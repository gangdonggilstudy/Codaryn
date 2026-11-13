/**
 * G-sec (U-274; GS-7, GS-9, standalone-gui 4.2): the real engine host process (build/src/engine-host,
 * started by the main process's own client) with the real engine (the root build, dist/src), and the
 * real CLI, on scripted task files: no model API, nothing sent anywhere (the host's test transport).
 * The default config locations point into the test folder.
 * - GS-9: the run log the window gets names the task-type tools a run called (inspect_files,
 *   propose_plan) by the engine catalog's labels, one line each, and shows a model-given name that no
 *   tool has as "(unknown tool)", never as given (U-250 kept the task-type names; before, they too
 *   read "(unknown tool)"); the run's events page shows them so too. Every item passes the main
 *   process's own check (parseRunItems), and the run's end its toRunResultView.
 * - GS-7: one workspace, one run: while a run the GUI's host started holds the workspace, the CLI's
 *   run of another task there ends as workspace_locked (exit 6); while a CLI run holds it, the
 *   host's start ends as workspace_locked, and that reaches the window as its code
 *   (toStartFailure). Each holding run is then cancelled through its own channel (the host's
 *   cancelRun, the CLI's cancel file), and no lock is left.
 * U-284: each case's folder comes from `scratch` (gsec-host-support.ts): after the case, even one
 * that failed or ran out of time, a CLI run it left is ended (through its cancel file, the process
 * only as a last resort), the host is closed and the folder removed.
 * Written by a session that did not implement the GUI.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { toRunResultView, toStartFailure } from "../../src/shared/ipc.js";
import { parseRunItems } from "../../src/shared/protocol.js";
import { ENGINE_DIR, WAIT, cli, exists, lockFile, scratch, skip, startHost, taskFile, waitFor, within } from "./gsec-host-support.js";

/** A tool name no tool list has, as a model could write it. */
const MADE_UP = "gsec_made_up_tool";

describe("G-sec: the real engine host process and the real CLI", () => {
  test("GS-9: the run log names the task-type tools by their labels, a name no tool has reads (unknown tool), the events page too", { skip, timeout: 120_000 }, async (t) => {
    const { EN_MESSAGES } = (await import(pathToFileURL(path.join(ENGINE_DIR, "i18n", "en.js")).href)) as { EN_MESSAGES: Record<string, string> };
    const [INSPECT, PROPOSE, UNKNOWN] = ["tool.inspect_files", "tool.propose_plan", "progress.unknown_tool"].map((key) => EN_MESSAGES[key] ?? "");
    assert.deepEqual([INSPECT, PROPOSE, UNKNOWN].map((label) => label!.length > 0), [true, true, true], "the catalog has the three labels");
    const space = await scratch(t);
    const { dir } = space;
    const { host, items, done } = await startHost(space);
    await fs.mkdir(path.join(dir, "work"), { recursive: true });
    await fs.writeFile(path.join(dir, "work", "a.txt"), "alpha\n", "utf8");
    const steps = [
      { toolCalls: [{ name: "inspect_files", args: { path: "." } }] },
      { toolCalls: [{ name: MADE_UP, args: {} }] },
      { toolCalls: [{ name: "propose_plan", args: { summary: "sort", actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }] } }] },
      { text: "done" },
    ];
    const task = await taskFile(dir, "organize", steps, { workflowRef: "organize", policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move"] } });
    const answer = await host.call("startTaskRun", { taskPath: task, varsFile: null, language: "en" }, 60_000);
    assert.ok(answer.ok, JSON.stringify(answer));
    const value = answer.value as { ok: boolean; runId?: string };
    assert.equal(value.ok, true, JSON.stringify(value));
    const outcome = await within(done, 60_000, "the run");
    assert.equal(toRunResultView(outcome).ok, true, `the main process takes the run's end: ${JSON.stringify(outcome).slice(0, 300)}`);

    const lines = items.map((item) => item.text);
    const log = lines.join("\n");
    const starting = (from: readonly string[], label: string) => from.filter((line) => line.startsWith(`${label} `));
    // The organize tools were offered and ran: their lines are not unknown_tool refusals.
    for (const label of [INSPECT!, PROPOSE!]) {
      assert.equal(starting(lines, label).length, 1, `one line for ${label}:\n${log}`);
      assert.equal(starting(lines, label)[0]!.includes("unknown_tool"), false, `${label} ran:\n${log}`);
    }
    assert.equal(starting(lines, UNKNOWN!).length, 1, `only the made-up name reads ${UNKNOWN}:\n${log}`);
    assert.equal(log.includes(MADE_UP), false, "the model-given name is never shown as given");

    const page = await host.call("runEvents", { workspace: await fs.realpath(path.join(dir, "work")), profile: null, workflowRef: "organize", runId: value.runId, offset: 0, language: "en" }, 60_000);
    assert.ok(page.ok, JSON.stringify(page));
    const pageValue = page.value as { ok: boolean; items?: unknown };
    assert.equal(pageValue.ok, true, JSON.stringify(pageValue).slice(0, 300));
    const pageItems = parseRunItems(pageValue.items);
    assert.ok(pageItems !== null, `the main process takes the page's items: ${JSON.stringify(pageValue).slice(0, 300)}`);
    const pageLines = pageItems.map((item) => item.text);
    for (const label of [INSPECT!, PROPOSE!, UNKNOWN!]) assert.equal(starting(pageLines, label).length, 1, `the events page: one line for ${label}:\n${pageLines.join("\n")}`);
    assert.equal(JSON.stringify(page.value).includes(MADE_UP), false, "the events page never shows the model-given name");
  });

  test("GS-7: a run the GUI's host started holds the workspace: the CLI's run there ends as workspace_locked", { skip, timeout: 120_000 }, async (t) => {
    const space = await scratch(t);
    const { dir } = space;
    const { host, done } = await startHost(space);
    const holding = await taskFile(dir, "holding", [WAIT]);
    const other = await taskFile(dir, "other", [{ text: "done" }]);
    const answer = await host.call("startTaskRun", { taskPath: holding, varsFile: null, language: "en" }, 60_000);
    const value = (answer as { value?: { ok: boolean; run?: string } }).value;
    assert.equal(value?.ok, true, JSON.stringify(answer));
    await waitFor(() => exists(lockFile(dir)), "the GUI's run taking the lock");

    const refused = await within(cli(space, ["run", "--task", other, "--json"]).ended, 60_000, "the CLI's run");
    assert.deepEqual([refused.code, refused.json?.["code"]], [6, "workspace_locked"], JSON.stringify(refused));

    const cancelled = await host.call("cancelRun", { run: value!.run }, 10_000);
    assert.deepEqual((cancelled as { value?: unknown }).value, { ok: true });
    const outcome = (await within(done, 60_000, "the GUI's run ending")) as { result?: { status?: string } };
    assert.equal(outcome.result?.status, "cancelled", JSON.stringify(outcome).slice(0, 300));
    await waitFor(async () => !(await exists(lockFile(dir))), "the lock going");
  });

  test("GS-7: a CLI run holds the workspace: the host's start ends as workspace_locked, and the window gets that code", { skip, timeout: 120_000 }, async (t) => {
    const space = await scratch(t);
    const { dir } = space;
    const { host } = await startHost(space);
    const cancelFile = path.join(dir, "cancel.flag");
    const holding = await taskFile(dir, "holding", [WAIT]);
    const other = await taskFile(dir, "other", [{ text: "done" }]);
    const running = cli(space, ["run", "--task", holding, "--json", "--cancel-file", cancelFile], cancelFile);
    await waitFor(() => exists(lockFile(dir)), "the CLI's run taking the lock");

    const answer = await host.call("startTaskRun", { taskPath: other, varsFile: null, language: "en" }, 60_000);
    assert.ok(answer.ok, JSON.stringify(answer));
    const value = answer.value as { ok: boolean; code?: string };
    assert.deepEqual([value.ok, value.code], [false, "workspace_locked"], JSON.stringify(value));
    assert.equal(toStartFailure(value).code, "workspace_locked", "the code the window gets");

    await fs.writeFile(cancelFile, "", "utf8");
    const ended = await within(running.ended, 60_000, "the CLI's run ending");
    assert.equal(ended.json?.["status"], "cancelled", JSON.stringify(ended));
    assert.equal(await exists(lockFile(dir)), false, "no lock left");
  });
});
