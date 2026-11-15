/**
 * U-210 first part (P1 bundle A, A-6; R-1, R-2, R-3, R-5, Q-4, R-102 M-1): the CLI's part of
 * unreadable paths and the group size k. The contract (U-197) and the gate and listing tools (U-203)
 * have them, but every parser refused `unreadablePaths` and `minGroupSize` (`unknown_field`) and
 * nothing built ResolvedTaskSpec.unreadablePaths or .minGroupSize or gave them to the gate, the tool
 * runner and the integrity checks.
 * Now:
 * - the task file, the config file, a profile and a task type definition take both (the list in
 *   protectedPaths' format; k a whole number from 5 to 1000, MIN_GROUP_SIZE_LIMITS);
 * - the run's unreadable paths are every source's entries united (config, profile, definition, task;
 *   the config file's also under a task file and a profile, R-2) and its k the largest stated, never
 *   below 5 (effectiveMinGroupSize); a run where no source states them is as before;
 * - the gate, the listing tools and the integrity checks get the run's list: a read, a listing and a
 *   write under it are denied as path/unreadable_path, a search leaves its entries out (withheld) and
 *   none of their text reaches the journal; the end summary says how many calls were refused there and
 *   what a person can do (U-207's lines);
 * - with any unreadable path the run refuses a command rule or a `command` verifier before anything is
 *   recorded (R-5), naming the field;
 * - the summary counts for U-207: denied unreadable_path calls and query_table results with hidden
 *   groups (the second from synthetic records: no tool runs query_table before U-208);
 * - doctor's commands check fails where a run would refuse (R-5).
 * Scripted model, temporary folders, a random canary; no network.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import type { EngineDeps, JournalEvent, JournalRecord, JsonObject, ResolvedTaskSpec } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { parseConfig } from "../../../src/cli/config.js";
import * as runModule from "../../../src/cli/run.js";
import type { RunNotes } from "../../../src/cli/run.js";
import { parseTask } from "../../../src/cli/task.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { cliEnv } from "../../support/cli.js";
import type { CliRun } from "../../support/cli.js";
import { runGuarded } from "../../support/fake-anthropic.js";
import { createSandbox, nodeCommand, writeWorkspaceFile } from "../../fixtures/builders.js";
import type { Sandbox } from "../../fixtures/builders.js";
import { writeConfigFile } from "../../fixtures/anthropic.js";
import { FAKE_API_KEY } from "../../fixtures/secrets.js";
import { createFileArgs, textStep, toolStep, writeGeneralTask } from "../../fixtures/general-tasks.js";
import { cliIo, setupRun } from "./k-support.js";

const TASK = {
  schemaVersion: 1,
  id: "u210",
  goal: "g",
  workflow: "analyze",
  workspaceRoot: "./ws",
  model: { provider: "scripted", scriptPath: "./script.json" },
  policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false },
  privacy: { secretEnv: [] },
  limits: { maxModelTurns: 8, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 },
  verifiers: [],
};
const POLICY = TASK.policy;
const LIMITS = { maxModelTurns: 8, maxToolCalls: 24, maxTotalTokens: 1000, maxDurationMs: 60_000 };
/** A value only the unreadable files hold, made at run time (letters and digits only). */
const CANARY = `cnry${randomBytes(6).toString("hex")}`;
const json = (run: CliRun): Record<string, unknown> => JSON.parse(run.stdout.trim().split("\n").pop() ?? "") as Record<string, unknown>;
const baseNotes = (): RunNotes => ({ configLanguage: null, configDefault: null, deniedToolCalls: 0, deniedCommandCalls: 0, failedToolCalls: 0 });

type NotePrivateData = (notes: RunNotes, event: JournalEvent) => void;
/** The run's observer of U-207's two counts (loosely typed, so this file builds before it exists). */
const notePrivateData = (runModule as unknown as { notePrivateData?: NotePrivateData }).notePrivateData;

function journalOf(sb: Sandbox, runId: string): { text: string; records: JournalRecord[] } {
  const text = readFileSync(path.join(sb.workspace, ".codaryn", "runs", runId, "journal.jsonl"), "utf8");
  return { text, records: text.split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line) as JournalRecord) };
}

function runDirs(sb: Sandbox): string[] {
  const dir = path.join(sb.workspace, ".codaryn", "runs");
  return existsSync(dir) ? readdirSync(dir) : [];
}

describe("U-210: the four places take unreadablePaths and minGroupSize", () => {
  test("a task file: both kept as given", () => {
    const outcome = parseTask({ ...TASK, policy: { ...POLICY, unreadablePaths: ["data/people", "hr.csv"], minGroupSize: 5 } }, process.cwd());
    assert.ok(outcome.ok, outcome.ok ? "" : outcome.message);
    if (!outcome.ok) return;
    assert.deepEqual([outcome.task.policy.unreadablePaths, outcome.task.policy.minGroupSize], [["data/people", "hr.csv"], 5]);
    const top = parseTask({ ...TASK, policy: { ...POLICY, minGroupSize: 1000 } }, process.cwd());
    assert.ok(top.ok && top.task.policy.minGroupSize === 1000, top.ok ? "" : top.message);
    const plain = parseTask(TASK, process.cwd());
    assert.ok(plain.ok && !Object.hasOwn(plain.task.policy, "unreadablePaths") && !Object.hasOwn(plain.task.policy, "minGroupSize"), "absent when not given");
  });

  test("a bad unreadable entry: invalid_task naming policy.unreadablePaths[i], as protectedPaths does", () => {
    const outcome = parseTask({ ...TASK, policy: { ...POLICY, unreadablePaths: ["data", "../x"] } }, process.cwd());
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.code, "invalid_task");
    assert.equal(outcome.message, "policy.unreadablePaths[1] must not contain a '..' segment");
    assert.deepEqual(outcome.position, { code: "invalid_value", field: "policy.unreadablePaths[1]" });
    const notList = parseTask({ ...TASK, policy: { ...POLICY, unreadablePaths: "data" } }, process.cwd());
    assert.ok(!notList.ok && notList.message === "policy.unreadablePaths must be an array of relative paths", notList.ok ? "" : notList.message);
  });

  test("k outside 5 to 1000, not whole or not a number: invalid_task naming policy.minGroupSize", () => {
    for (const value of [4, 0, -5, 1001, 7.5, "7", null, Number.NaN]) {
      const outcome = parseTask({ ...TASK, policy: { ...POLICY, minGroupSize: value } }, process.cwd());
      assert.equal(outcome.ok, false, String(value));
      if (outcome.ok) continue;
      assert.equal(outcome.code, "invalid_task");
      assert.equal(outcome.message, "policy.minGroupSize must be a whole number from 5 to 1000");
      assert.deepEqual(outcome.position, { code: "invalid_value", field: "policy.minGroupSize" });
    }
  });

  test("the config file's policy, a profile's policy and a definition's policy", () => {
    const policy = { ...POLICY, unreadablePaths: ["private"], minGroupSize: 9 };
    const outcome = parseConfig({ schemaVersion: 1, policy, profiles: { p: { policy } }, workflows: { d: { tools: ["read_file", "write_file"], policy } } });
    assert.ok(outcome.ok, outcome.ok ? "" : outcome.message);
    if (!outcome.ok) return;
    for (const parsed of [outcome.config.policy, outcome.config.profiles?.["p"]?.policy, outcome.config.workflows?.["d"]?.policy]) {
      assert.deepEqual([parsed?.unreadablePaths, parsed?.minGroupSize], [["private"], 9]);
    }
    const low = parseConfig({ schemaVersion: 1, policy: { ...POLICY, minGroupSize: 2 } });
    assert.ok(!low.ok && low.message === "policy.minGroupSize must be a whole number from 5 to 1000", "no source lowers k below 5, the config file included (DR-70)");
  });
});

describe("U-210: the run's list and k (ResolvedTaskSpec), and what gets them", () => {
  interface Captured {
    task: ResolvedTaskSpec | null;
    deps: EngineDeps | null;
  }

  async function capture(argv: (base: string) => string[], files: Record<string, string>, task: Record<string, unknown>, config: Record<string, unknown>): Promise<Captured> {
    const base = await setupRun(files, task, [{ text: "done", usage: { inputTokens: 0, outputTokens: 0 } }]);
    // No limits: setupRun's task has no token limit, which a config limit would refuse.
    await writeFile(path.join(base, "c.json"), JSON.stringify({ schemaVersion: 1, ...config }), "utf8");
    const captured: Captured = { task: null, deps: null };
    const io = cliIo(base, {
      argv: argv(base),
      assemble: async (input) => {
        captured.task = input.task;
        const assembled = await assembleRun(input);
        if (assembled.ok) captured.deps = assembled.deps;
        return assembled;
      },
    });
    const outcome = await runModule.runCli(io);
    assert.equal((outcome.output as { kind: string }).kind, "run", JSON.stringify(outcome.output));
    return captured;
  }

  test("every source united in order (config, profile, definition, task), each once; k the largest stated", async () => {
    const config = {
      policy: { ...POLICY, unreadablePaths: ["private"], minGroupSize: 8 },
      profiles: { p: { policy: { ...POLICY, unreadablePaths: ["hr"], minGroupSize: 6 } } },
      workflows: { d: { tools: ["read_file", "search_files", "write_file"], policy: { ...POLICY, unreadablePaths: ["data/raw"], minGroupSize: 12 } } },
    };
    const task = { workflowRef: "d", policy: { ...POLICY, unreadablePaths: ["secret", "private"], minGroupSize: 5 } };
    const captured = await capture((base) => ["run", "--task", path.join(base, "task.json"), "--config", path.join(base, "c.json"), "--profile", "p"], { "README.md": "# Title\n" }, task, config);
    assert.deepEqual(captured.task?.unreadablePaths, ["private", "hr", "data/raw", "secret"]);
    assert.equal(captured.task?.minGroupSize, 12);
    assert.ok(captured.deps?.integrity !== undefined, "the integrity checks watch the unreadable paths");
  });

  test("the config file's entries hold under a task file whose own policy has none (R-2); k not stated is absent", async () => {
    const captured = await capture(
      (base) => ["run", "--task", path.join(base, "task.json"), "--config", path.join(base, "c.json")],
      { "README.md": "# Title\n" },
      {},
      { policy: { ...POLICY, unreadablePaths: ["private"] } },
    );
    assert.deepEqual(captured.task?.unreadablePaths, ["private"]);
    assert.equal(Object.hasOwn(captured.task ?? {}, "minGroupSize"), false);
  });

  test("no source states either: neither field, no integrity checker, as before", async () => {
    const captured = await capture((base) => ["run", "--task", path.join(base, "task.json"), "--config", path.join(base, "c.json")], { "README.md": "# Title\n" }, {}, {});
    assert.equal(Object.hasOwn(captured.task ?? {}, "unreadablePaths") || Object.hasOwn(captured.task ?? {}, "minGroupSize"), false);
    assert.equal(captured.deps?.integrity, undefined);
  });
});

describe("U-210 on the real CLI: the unreadable files are kept from the agent", () => {
  test("read, search and write under the config's and the task's entries; the end says how many and why", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    writeWorkspaceFile(sb, "README.md", "# Title\n");
    writeWorkspaceFile(sb, "public.txt", "row public\n");
    writeWorkspaceFile(sb, "private/people.csv", `name,phone\nrow ${CANARY},010\n`);
    writeWorkspaceFile(sb, "secret/note.txt", `row ${CANARY}\n`);
    const config = writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, policy: { ...POLICY, unreadablePaths: ["private"] } }, "c.json");
    const steps = [
      toolStep("read_file", { path: "private/people.csv" }),
      toolStep("read_file", { path: "secret/note.txt" }),
      toolStep("read_file", { path: "public.txt" }),
      toolStep("search_files", { path: ".", text: "row" }),
      toolStep("write_file", createFileArgs("private/new.csv", "a\n")),
      textStep("done"),
    ];
    const task = writeGeneralTask(sb, { id: "u210-run", policy: { unreadablePaths: ["secret"] } }, steps);
    for (const lang of ["en", "ko"]) {
      const ran = await runGuarded(sb, ["run", "--task", task, "--config", config], cliEnv({ extra: { CODARYN_LANG: lang } }));
      const output = json(ran);
      assert.equal(output["kind"], "run", ran.stdout);
      const { text, records } = journalOf(sb, output["runId"] as string);
      const decisions = records.flatMap((record) => (record.type === "tool_decision" ? [record.allowed ? "allowed" : `${record.permission}/${record.code}`] : []));
      assert.deepEqual(decisions, ["path/unreadable_path", "path/unreadable_path", "allowed", "allowed", "path/unreadable_path"]);
      const search = records.find((record) => record.type === "tool_result" && record.result.tool === "search_files");
      assert.ok(search !== undefined && search.type === "tool_result" && typeof search.result.content === "string");
      const payload = JSON.parse(search.result.content as string) as { entries: { path: string }[]; withheld?: boolean };
      assert.deepEqual(payload.entries.map((entry) => entry.path), ["public.txt"], "the unreadable files' lines are left out");
      assert.equal(payload.withheld, true);
      assert.equal(text.includes(CANARY), false, "no text of an unreadable file reaches the journal");
      assert.equal(existsSync(path.join(sb.workspace, "private", "new.csv")), false);
      const catalog = createMessageCatalog(lang === "ko" ? "ko" : "en");
      assert.ok(ran.stderr.includes(catalog.format("summary.denied_unreadable", { count: 3 })), ran.stderr);
      assert.ok(ran.stderr.includes(catalog.format("summary.denied_unreadable_hint")), ran.stderr);
    }
  });
});

describe("U-210: a command rule or a command verifier with unreadable paths is refused before the run (R-5)", () => {
  function commandRule(sb: Sandbox): JsonObject {
    const script = path.join(sb.base, "tool.js");
    writeFileSync(script, "process.exit(0)\n");
    return { ...nodeCommand(script), argsPrefix: [script] } as unknown as JsonObject;
  }

  test("a task file's command rule or command verifier under the config's entries: invalid_task, nothing recorded", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    writeWorkspaceFile(sb, "README.md", "# Title\n");
    const config = writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, policy: { ...POLICY, unreadablePaths: ["private"] } }, "c.json");
    const rule = commandRule(sb);
    const withRule = writeGeneralTask(sb, { id: "u210-rule", policy: { commands: [rule] } }, [textStep("not requested")]);
    const refused = json(await runGuarded(sb, ["run", "--task", withRule, "--config", config], cliEnv()));
    assert.equal(refused["code"], "invalid_task", JSON.stringify(refused));
    assert.match(String(refused["message"]), /^policy\.commands must be empty while unreadablePaths is set/);
    const verifier = { id: "check", kind: "command", executable: rule["executable"], args: rule["argsPrefix"] } as unknown as JsonObject;
    const withVerifier = writeGeneralTask(sb, { id: "u210-verifier", verifiers: [verifier] as never }, [textStep("not requested")]);
    const second = json(await runGuarded(sb, ["run", "--task", withVerifier, "--config", config], cliEnv()));
    assert.equal(second["code"], "invalid_task", JSON.stringify(second));
    assert.match(String(second["message"]), /^verifiers\[0\] cannot be a command verifier while unreadablePaths is set/);
    assert.deepEqual(runDirs(sb), [], "no run was recorded");
    // The same task file without the config's entries runs.
    const free = json(await runGuarded(sb, ["run", "--task", withRule], cliEnv()));
    assert.equal(free["kind"], "run", JSON.stringify(free));
  });

  test("a definition's command verifier under a task file's entries, and the quick form's config: invalid_config", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    writeWorkspaceFile(sb, "README.md", "# Title\n");
    const rule = commandRule(sb);
    const verifier = { id: "check", kind: "command", executable: rule["executable"], args: rule["argsPrefix"] };
    const defined = writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, workflows: { d: { tools: ["read_file", "write_file"], verifiers: [verifier] } } }, "d.json");
    const typed = writeGeneralTask(sb, { id: "u210-definition", fields: { workflowRef: "d" }, policy: { unreadablePaths: ["private"] } }, [textStep("not requested")]);
    const refused = json(await runGuarded(sb, ["run", "--task", typed, "--config", defined], cliEnv()));
    assert.equal(refused["code"], "invalid_config", JSON.stringify(refused));
    assert.match(String(refused["message"]), /^workflows\.verifiers\[0\] cannot be a command verifier while unreadablePaths is set/);
    const quick = writeConfigFile(
      sb,
      { schemaVersion: 1, model: "fake-model-id", maxOutputTokens: 1000, limits: LIMITS, policy: { ...POLICY, commands: [rule], unreadablePaths: ["private"] } },
      "q.json",
    );
    const second = json(await runGuarded(sb, ["run", "--workspace", sb.workspace, "--goal", "g", "--config", quick], cliEnv({ fakeApiKey: FAKE_API_KEY })));
    assert.equal(second["code"], "invalid_config", JSON.stringify(second));
    assert.match(String(second["message"]), /^policy\.commands must be empty while unreadablePaths is set/);
    assert.deepEqual(runDirs(sb), [], "no run was recorded");
  });
});

describe("U-210: U-207's summary counts", () => {
  const groups = (suppressedGroups: number, minGroupSize: number): JournalEvent => ({
    type: "tool_result",
    result: {
      callId: "c1",
      tool: "query_table",
      ok: true,
      content: JSON.stringify({ kind: "groups", groupBy: ["region"], operations: [{ op: "count", column: "id" }], groups: [], suppressedGroups, next: null, minGroupSize }),
    } as never,
  });

  test("denied unreadable_path calls, and query_table results that hid groups with the largest k", () => {
    assert.equal(typeof notePrivateData, "function", "run.ts exports notePrivateData");
    if (notePrivateData === undefined) return;
    const notes = baseNotes();
    const denial = (code: string): JournalEvent => ({ type: "tool_decision", callId: "c0", tool: "read_file", allowed: false, permission: "path", code } as never);
    for (const event of [denial("unreadable_path"), denial("protected_path"), denial("unreadable_path"), groups(0, 5), groups(2, 5), groups(1, 9), groups(3, 7)]) notePrivateData(notes, event);
    const counted = notes as RunNotes & { deniedUnreadable?: number; hiddenGroups?: { results: number; minGroupSize: number } };
    assert.equal(counted.deniedUnreadable, 2);
    assert.deepEqual(counted.hiddenGroups, { results: 3, minGroupSize: 9 });
    const none = baseNotes();
    for (const event of [denial("protected_path"), groups(0, 5)]) notePrivateData(none, event);
    assert.equal(Object.hasOwn(none, "deniedUnreadable") || Object.hasOwn(none, "hiddenGroups"), false, "nothing to count, no field");
  });
});

describe("U-210: doctor's commands check where a run would refuse (R-5)", () => {
  test("unreadable paths with a command rule: fail; either alone: as before", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    const script = path.join(sb.base, "tool.js");
    writeFileSync(script, "process.exit(0)\n");
    const rule = { ...nodeCommand(script), argsPrefix: [script] } as unknown as JsonObject;
    const check = async (policy: JsonObject): Promise<{ status: string; text?: { id: string } }> => {
      const task = writeGeneralTask(sb, { id: "u210-doctor", policy }, [textStep("done")]);
      const ran = await runGuarded(sb, ["doctor", "--task", task, "--json"], cliEnv());
      const output = JSON.parse(ran.stdout.trim()) as { checks: { id: string; status: string; text?: { id: string } }[] };
      const found = output.checks.find((entry) => entry.id === "commands");
      assert.ok(found !== undefined, ran.stdout);
      return found;
    };
    const together = await check({ commands: [rule], unreadablePaths: ["private"] });
    assert.equal(together.status, "fail");
    assert.equal(together.text?.id, "doctor.commands.unreadable_with_commands");
    assert.equal((await check({ commands: [rule] })).status, "ok");
    assert.equal((await check({ unreadablePaths: ["private"] })).status, "skipped");
  });
});
