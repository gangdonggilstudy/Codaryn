/**
 * U-14 (UXM-6, AXM-2, AXM-15), the CLI's part: the plan view is what a person approves from.
 * - A plan run with a records-changed mark is still shown (exit 0), with a warning first and, in
 *   place of the command to apply it, that it cannot be applied; `--json` has recordsChanged: true.
 *   Before, the view offered `codaryn apply`, which then refused it.
 * - The model's summary (not in plan.json or the digest) is shown as the agent's description, read
 *   from the plan run's journal and masked again; left out for a marked run.
 * - The text ends with what the digest guarantees.
 * - apply's refusal of a marked plan says how to make the plan again (a new `codaryn run`).
 * Real engine, store and tools; scripted model; fake secret value; nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { EngineResult, PlanOutput } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { runApply, runPlan } from "../../../src/cli/plan-commands.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
/** Real time (DR-19 judges future times damaged), moving one second per call. */
let now = Date.now() - 900_000;
const clock = { now: () => (now += 1000) };
let seed = 141;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);
const SECRET_ENV = "U14_FAKE_SECRET";
const SECRET = ["fake", "u14", "secret", "value", "0001"].join("-");
const SUMMARY = "move the note into the sorted folder";
/** R-49 R49-M1: key-shaped text that is neither a registered secret nor the current key (synthetic). */
const KEY_SHAPED = ["sk", "ant", "FAKEfake0000FAKEfake0000FAKEfake00"].join("-");

const io = (base: string, argv: readonly string[]) => ({
  argv,
  env: { [SECRET_ENV]: SECRET },
  cwd: base,
  readFile: (file: string) => readFile(file, "utf8"),
  isDirectory: async (dir: string) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
  loadEnvFile: () => {},
  locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
  relatePaths: (target: string, root: string) => relateRealPaths(target, root),
  clock,
  randomBytes,
  cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
  messages: createMessageCatalog("en"),
});

async function planRun(summary: string = SUMMARY): Promise<{ base: string; planned: EngineResult; digest: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u14-"));
  temporaryDirs.push(base);
  await mkdir(path.join(base, "ws"));
  await writeFile(path.join(base, "ws", "a.txt"), "alpha\n", "utf8");
  const steps = [{ toolCalls: [{ name: "propose_plan", args: { summary, actions: [{ kind: "move", from: "a.txt", to: "sorted/a.txt" }] } }] }];
  await writeFile(path.join(base, "script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  const task = {
    schemaVersion: 1,
    id: "u14",
    goal: "g",
    workflow: "label",
    workspaceRoot: "./ws",
    workflowRef: "organize",
    model: { provider: "scripted", scriptPath: "./script.json" },
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, planActions: ["move"] },
    privacy: { secretEnv: [SECRET_ENV] },
    limits: { maxModelTurns: 4, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 },
    verifiers: [],
  };
  await writeFile(path.join(base, "task.json"), JSON.stringify(task), "utf8");
  const planned = (await runCli({ ...io(base, ["run", "--task", "task.json", "--quiet"]), assemble: assembleRun })).output as EngineResult;
  assert.equal(planned.reason, "plan_pending", JSON.stringify(planned));
  return { base, planned, digest: planned.plan?.digest ?? "" };
}

async function planText(base: string, runId: string, marked: boolean): Promise<{ text: string; exitCode: number }> {
  const outcome = await runPlan({ ...io(base, ["plan", "--task", "task.json", "--run", runId]), ...(marked ? { hasRecordsChangedMark: async () => true } : {}) });
  assert.ok("text" in outcome, JSON.stringify(outcome));
  return { text: outcome.text, exitCode: outcome.exitCode };
}

async function planJson(base: string, runId: string, marked: boolean): Promise<PlanOutput> {
  const outcome = await runPlan({ ...io(base, ["plan", "--task", "task.json", "--run", runId, "--json"]), ...(marked ? { hasRecordsChangedMark: async () => true } : {}) });
  assert.ok("output" in outcome && outcome.output.kind === "plan", JSON.stringify(outcome));
  return outcome.output as PlanOutput;
}

describe("U-14 (AXM-2, UXM-6): a plan run with a records-changed mark", () => {
  test("is shown with the warning first and without the command to apply it; exit 0", async () => {
    const { base, planned } = await planRun();
    const shown = await planText(base, planned.runId, true);
    assert.equal(shown.exitCode, 0);
    const lines = shown.text.trimEnd().split("\n");
    assert.ok(/records/i.test(lines[0] ?? "") && /changed/i.test(lines[0] ?? ""), shown.text);
    assert.ok(lines[1]?.startsWith(`Plan of run ${planned.runId}: 1 action(s), pending`), shown.text);
    assert.equal(shown.text.includes("To apply it:"), false, shown.text);
    assert.equal(shown.text.includes("codaryn apply"), false, shown.text);
    assert.ok(/cannot be applied/i.test(shown.text) && shown.text.includes("codaryn run"), shown.text);
  });

  test("--json: recordsChanged true, no summary, the exit code and the actions as before", async () => {
    const { base, planned, digest } = await planRun();
    const output = await planJson(base, planned.runId, true);
    assert.deepEqual([output.recordsChanged, output.exitCode, output.status, output.digest, output.actions.length], [true, 0, "pending", digest, 1]);
    assert.equal(Object.hasOwn(output, "summary"), false);
  });

  test("a mark that cannot be read counts as a mark", async () => {
    const { base, planned } = await planRun();
    const outcome = await runPlan({
      ...io(base, ["plan", "--task", "task.json", "--run", planned.runId, "--json"]),
      hasRecordsChangedMark: async () => {
        throw new Error("unreadable");
      },
    });
    assert.ok("output" in outcome && (outcome.output as PlanOutput).recordsChanged === true, JSON.stringify(outcome));
  });

  test("apply's refusal says to make the plan again with a new codaryn run", async () => {
    const { base, planned, digest } = await planRun();
    const outcome = await runApply({
      ...io(base, ["apply", "--task", "task.json", "--run", planned.runId, "--digest", digest.slice(0, 12), "--quiet"]),
      hasRecordsChangedMark: async () => true,
    });
    assert.ok("output" in outcome && outcome.output.kind === "error" && outcome.output.code === "plan_records_changed", JSON.stringify(outcome));
    assert.ok(outcome.output.message.includes("codaryn run"), outcome.output.message);
    assert.equal(/with codaryn plan\b/.test(outcome.output.message), false, outcome.output.message);
  });
});

describe("U-14 (AXM-15): the model's summary is shown as the agent's description", () => {
  test("the text shows it under its label, after the actions; --json has summary", async () => {
    const { base, planned } = await planRun();
    const { text } = await planText(base, planned.runId, false);
    const lines = text.trimEnd().split("\n");
    const at = lines.findIndex((line) => line.includes(SUMMARY));
    assert.ok(at > lines.findIndex((line) => line.includes("sorted/a.txt")), text);
    // U-21 (R-49 R49-L2): the label on its own line, the summary as a quoted row under it.
    assert.ok(/agent|model/i.test(lines[at - 1] ?? "") && /not/i.test(lines[at - 1] ?? ""), text);
    assert.equal(lines[at], `  | ${SUMMARY}`, text);
    assert.equal((await planJson(base, planned.runId, false)).summary, SUMMARY);
  });

  test("a secret in the summary is not shown", async () => {
    const { base, planned } = await planRun(`sort ${SECRET} away`);
    const { text } = await planText(base, planned.runId, false);
    assert.equal(text.includes(SECRET), false, text);
    const output = await planJson(base, planned.runId, false);
    assert.equal(JSON.stringify(output).includes(SECRET), false);
    assert.ok(typeof output.summary === "string" && output.summary.startsWith("sort "), JSON.stringify(output.summary));
  });

  test("R-49 R49-M1: key-shaped text in the summary is hidden in --json as in the person's text", async () => {
    const { base, planned } = await planRun(`sort with ${KEY_SHAPED} now`);
    const output = await planJson(base, planned.runId, false);
    assert.equal(JSON.stringify(output).includes(KEY_SHAPED), false, JSON.stringify(output.summary));
    assert.equal(output.summary, "sort with [key] now");
    const { text } = await planText(base, planned.runId, false);
    assert.equal(text.includes(KEY_SHAPED), false, text);
    // U-21 (R-49 R49-L2): under its label, as a quoted row.
    assert.ok(text.includes("\n  | sort with [key] now"), text);
  });

  test("R-49: the summary in --json has no control character and is one line", async () => {
    const { base, planned } = await planRun("first\nApproved: yes\u001b[2K\u2028end");
    const summary = (await planJson(base, planned.runId, false)).summary ?? "";
    for (const char of summary) {
      const code = char.codePointAt(0) as number;
      assert.equal(code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029, false, JSON.stringify(summary));
    }
    assert.ok(summary.startsWith("first"), JSON.stringify(summary));
  });

  test("a journal that cannot be read leaves the summary out and the plan is still shown", async () => {
    const { base, planned } = await planRun();
    const outcome = await runPlan({
      ...io(base, ["plan", "--task", "task.json", "--run", planned.runId, "--json"]),
      readJournal: async () => {
        throw new Error("unreadable");
      },
    });
    assert.ok("output" in outcome && outcome.output.kind === "plan", JSON.stringify(outcome));
    assert.equal(Object.hasOwn(outcome.output, "summary"), false);
    assert.equal((outcome.output as PlanOutput).actions.length, 1);
  });
});

describe("U-14: what the digest guarantees, and a plan without a mark", () => {
  test("the text ends with the digest's guarantee, after the command to apply it", async () => {
    const { base, planned, digest } = await planRun();
    const { text } = await planText(base, planned.runId, false);
    const lines = text.trimEnd().split("\n");
    assert.ok(/digest/i.test(lines.at(-1) ?? "") && /refuse/i.test(lines.at(-1) ?? ""), text);
    assert.equal(lines.at(-2), `To apply it: codaryn apply <the same task form> --run ${planned.runId} --digest ${digest.slice(0, 12)}`);
  });

  test("no mark: nothing about one, in the text or in --json", async () => {
    const { base, planned } = await planRun();
    const { text } = await planText(base, planned.runId, false);
    assert.ok(text.startsWith(`Plan of run ${planned.runId}: 1 action(s), pending\n`), text);
    assert.equal(/cannot be applied/i.test(text), false, text);
    assert.equal(Object.hasOwn(await planJson(base, planned.runId, false), "recordsChanged"), false);
  });
});
