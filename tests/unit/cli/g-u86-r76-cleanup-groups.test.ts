/**
 * U-86, review R-76 (PM: fix, then merge). M-1: an item that needs both flags (an apply run not
 * reverted whose discarded files go with it, and its plan run) was in the --delete-discarded group,
 * whose line names --delete-discarded alone: "3" read as what that flag removes, though it removed
 * 1. Now such items have a group of their own (cleanup.group.both), and each group's count is what
 * its flags add: --confirm alone removes the confirm group, each flag adds its group, both flags add
 * cleanup.group.both too. L-1: a blocked item's line stood under the group above it, as if one of
 * its items; now the blocked items come last, under cleanup.group.blocked.
 * The review's table (its section 2) for the workspace of U-13's procedure, with the real engine,
 * store and tools: a plan run P1, its apply run A1 (not reverted; it discarded a person's file) and
 * a run R that changed nothing. Each selection is previewed, then confirmed on a copy of the state
 * under each of the four confirmations; what was removed must be exactly what the groups said.
 * A stand-in catalog shows which text each line is; scripted model; nothing is sent.
 */

import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { ApplyResult, CleanupOutput, EngineResult, MessageCatalog, MessageId } from "../../../src/contracts/index.js";
import { assembleRun } from "../../../src/cli/assemble.js";
import { itemName, renderCleanup, runCleanup } from "../../../src/cli/cleanup.js";
import { runApply } from "../../../src/cli/plan-commands.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { DIGEST, RUN_B, RUN_D, preview } from "./u34-cleanup-fixtures.js";
import { PLAN_BOTH, withFates } from "./u86-cleanup-fixtures.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
/** Real time (DR-19 judges future times damaged), moving one second per call. */
let now = Date.now() - 900_000;
const clock = { now: () => (now += 1000) };
let seed = 186;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);
const POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };
const LIMITS = { maxModelTurns: 6, maxToolCalls: 8, maxTotalTokens: null, maxDurationMs: 60_000 };

type Format = (id: MessageId, params?: Record<string, number>) => string;
const standIn = {
  language: "en",
  format: (id: MessageId, params?: Record<string, number>) =>
    `<${id}${params === undefined || Object.keys(params).length === 0 ? "" : ` ${JSON.stringify(params)}`}>`,
} as unknown as MessageCatalog;
const f: Format = standIn.format as Format;
const text = (lines: readonly string[]): string => `${lines.join("\n")}\n`;

const io = (base: string, argv: readonly string[]) => ({
  argv,
  env: {},
  cwd: base,
  readFile: (file: string) => readFile(file, "utf8"),
  isDirectory: async (dir: string) => (await stat(dir).catch(() => null))?.isDirectory() ?? false,
  loadEnvFile: () => {},
  locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
  relatePaths: (target: string, root: string) => relateRealPaths(target, root),
  clock,
  randomBytes,
  cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
});

/** U-13's workspace: P1 planned a discard, A1 applied it (not reverted), R changed nothing. */
async function workspace(): Promise<{ base: string; p1: string; a1: string; r: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "codaryn-g-u86-r76-"));
  temporaryDirs.push(base);
  const work = path.join(base, "work");
  await mkdir(path.join(work, "inbox"), { recursive: true });
  await writeFile(path.join(work, "inbox", "old-draft.tmp"), "a person's draft\n", "utf8");
  const steps = [{ toolCalls: [{ name: "propose_plan", args: { summary: "tidy", actions: [{ kind: "discard", path: "inbox/old-draft.tmp" }] } }] }];
  await writeFile(path.join(base, "p.script.json"), JSON.stringify({ schemaVersion: 1, steps }), "utf8");
  const task = {
    schemaVersion: 1,
    id: "p",
    goal: "g",
    workflow: "label",
    workspaceRoot: "./work",
    workflowRef: "organize",
    model: { provider: "scripted", scriptPath: "./p.script.json" },
    policy: { ...POLICY, planActions: ["discard"] },
    privacy: { secretEnv: [] },
    limits: LIMITS,
    verifiers: [],
  };
  await writeFile(path.join(base, "p.task.json"), JSON.stringify(task), "utf8");
  const planned = (await runCli({ ...io(base, ["run", "--task", "p.task.json", "--quiet"]), assemble: assembleRun })).output as EngineResult;
  assert.equal(planned.reason, "plan_pending", JSON.stringify(planned));
  const applied = await runApply(io(base, ["apply", "--task", "p.task.json", "--run", planned.runId, "--digest", (planned.plan?.digest ?? "").slice(0, 12), "--quiet"]));
  assert.ok("output" in applied && applied.output.kind === "apply", JSON.stringify(applied));
  await writeFile(path.join(base, "o.script.json"), JSON.stringify({ schemaVersion: 1, steps: [{ text: "done" }] }), "utf8");
  const other = { ...task, id: "o", workflow: "test", workflowRef: undefined, model: { provider: "scripted", scriptPath: "./o.script.json" }, policy: POLICY };
  await writeFile(path.join(base, "o.task.json"), JSON.stringify(other), "utf8");
  const plain = (await runCli({ ...io(base, ["run", "--task", "o.task.json", "--quiet"]), assemble: assembleRun })).output as EngineResult;
  return { base, p1: planned.runId, a1: (applied.output as unknown as ApplyResult).runId, r: plain.runId };
}

async function cleanup(base: string, args: readonly string[], json: boolean): Promise<{ text: string; exitCode: number }> {
  const outcome = await runCleanup({ argv: ["cleanup", "--workspace", "work", ...args, ...(json ? ["--json"] : [])], cwd: base, env: {}, clock, messages: standIn });
  assert.ok("text" in outcome, JSON.stringify(outcome));
  return { text: outcome.text, exitCode: outcome.exitCode };
}

/** The preview's groups as shown: each one's id, its count and the items listed under it. */
type Shown = { readonly group: string; readonly count: number; readonly items: string[] };
function groupsOf(shown: string): Shown[] {
  const groups: { group: string; count: number; items: string[] }[] = [];
  for (const line of shown.split("\n")) {
    const header = /^<cleanup\.group\.([a-z_]+) (\{.*\})>$/.exec(line);
    if (header !== null) {
      groups.push({ group: header[1] ?? "", count: (JSON.parse(header[2] ?? "{}") as { count: number }).count, items: [] });
      continue;
    }
    const item = /^- <cleanup\.target\.([a-z]+)> (\S+): /.exec(line);
    if (item !== null) {
      const last = groups.at(-1);
      assert.ok(last !== undefined, `an item line before any group line:\n${shown}`);
      last.items.push(`${item[1]}:${item[2]}`);
    }
  }
  return groups;
}

/** What each confirmation must remove: the confirm group, and each group whose flags it gives. */
const CONFIRMATIONS = [
  { flags: [], groups: ["confirm"] },
  { flags: ["--include-not-reverted"], groups: ["confirm", "include_not_reverted"] },
  { flags: ["--delete-discarded"], groups: ["confirm", "delete_discarded"] },
  { flags: ["--include-not-reverted", "--delete-discarded"], groups: ["confirm", "include_not_reverted", "delete_discarded", "both"] },
] as const;

/** Confirms the selection on a copy of the state under each confirmation; how many went, and which. */
async function removedUnder(base: string, selection: readonly string[]): Promise<{ count: number; items: string[] }[]> {
  const removed: { count: number; items: string[] }[] = [];
  for (const { flags } of CONFIRMATIONS) {
    const copy = await mkdtemp(path.join(tmpdir(), "codaryn-g-u86-r76-copy-"));
    temporaryDirs.push(copy);
    await cp(path.join(base, "work"), path.join(copy, "work"), { recursive: true });
    const shown = JSON.parse((await cleanup(copy, selection, true)).text) as CleanupOutput;
    assert.ok(shown.status === "preview", JSON.stringify(shown));
    const done = JSON.parse((await cleanup(copy, [...selection, "--confirm", shown.plan.digest.slice(0, 12), ...flags], true)).text) as CleanupOutput;
    assert.ok(done.status !== "preview", JSON.stringify(done));
    const items = done.outcome.removed.map((item) => `${item.target}:${itemName(item)}`).sort();
    removed.push({ count: items.length, items });
  }
  return removed;
}

/** The groups' counts are their lines', and each confirmation removes exactly the groups it gives. */
async function check(base: string, selection: readonly string[]): Promise<{ groups: Shown[]; removed: number[]; shown: string }> {
  const shown = (await cleanup(base, selection, false)).text;
  const groups = groupsOf(shown);
  for (const group of groups) assert.equal(group.count, group.items.length, `the count of ${group.group} is its lines'\n${shown}`);
  const removed = await removedUnder(base, selection);
  CONFIRMATIONS.forEach(({ flags, groups: given }, index) => {
    const expected = groups.filter((group) => (given as readonly string[]).includes(group.group)).flatMap((group) => group.items).sort();
    assert.deepEqual(removed[index]?.items, expected, `with --confirm ${flags.join(" ")}: what the groups said\n${shown}`);
  });
  return { groups, removed: removed.map((entry) => entry.count), shown };
}
const counts = (groups: readonly Shown[]): Record<string, number> => Object.fromEntries(groups.map((group) => [group.group, group.count]));

describe("U-86, R-76 M-1: the items that need both flags have a group of their own", () => {
  test("--older-than 0 --discarded-older-than 0: R alone, A1's folder with --delete-discarded, A1 and P1 only with both", async () => {
    const { base, p1, a1, r } = await workspace();
    const { groups, removed } = await check(base, ["--older-than", "0", "--discarded-older-than", "0"]);
    assert.deepEqual(counts(groups), { confirm: 1, delete_discarded: 1, both: 2 });
    assert.deepEqual(groups.find((group) => group.group === "both")?.items.sort(), [`run:${a1}`, `run:${p1}`].sort());
    assert.deepEqual(groups.find((group) => group.group === "delete_discarded")?.items, [`discarded:${a1}`]);
    assert.deepEqual(groups.find((group) => group.group === "confirm")?.items, [`run:${r}`]);
    // Under no flag, --include-not-reverted, --delete-discarded, both (the review's 0, 0, 1, 3 and R).
    assert.deepEqual(removed, [1, 1, 2, 4]);
  });

  test("--run A1 --discarded-run A1: the folder with --delete-discarded, A1 only with both", async () => {
    const { base, a1 } = await workspace();
    const { groups, removed } = await check(base, ["--run", a1, "--discarded-run", a1]);
    assert.deepEqual(counts(groups), { delete_discarded: 1, both: 1 });
    assert.deepEqual(removed, [0, 0, 1, 2]);
  });

  test("--run R: one run with --confirm alone, no other group", async () => {
    const { base, r } = await workspace();
    const { groups, removed } = await check(base, ["--run", r]);
    assert.deepEqual(counts(groups), { confirm: 1 });
    assert.deepEqual(removed, [1, 1, 1, 1]);
  });
});

describe("U-86, R-76 L-1: what cannot be removed comes last, under its own line", () => {
  test("--run P1 --discarded-run A1: the folder's group, then the blocked plan run under cleanup.group.blocked", async () => {
    const { base, p1, a1 } = await workspace();
    const { groups, removed, shown } = await check(base, ["--run", p1, "--discarded-run", a1]);
    assert.deepEqual(counts(groups), { delete_discarded: 1, blocked: 1 });
    assert.deepEqual(groups.at(-1)?.items, [`run:${p1}`], "the blocked group is last");
    assert.deepEqual(removed, [0, 0, 1, 1]);
    const lines = shown.split("\n");
    const at = lines.indexOf(f("cleanup.group.blocked", { count: 1 }));
    assert.ok(at > 0, shown);
    assert.deepEqual(lines.slice(at, at + 3), [f("cleanup.group.blocked", { count: 1 }), `- ${f("cleanup.target.run")} ${p1}: ${f("cleanup.blocked.plan_used_by_apply")}`, ""], shown);
    // Then the command, which needs --delete-discarded alone (the blocked run needs nothing).
    const command = lines[at + 3] ?? "";
    assert.ok(command.startsWith(`${f("cleanup.command.all")} --confirm `) && command.endsWith(" --delete-discarded") && !command.includes("--include-not-reverted"), shown);
  });

  test("blocked items only: the blocked group alone, and no command", () => {
    const plan = withFates({ ...PLAN_BOTH, items: [], blocked: [{ target: "run", runId: RUN_D, code: "no_result" }], digest: DIGEST }, []);
    const shown = renderCleanup(preview(plan), standIn);
    assert.ok(shown.endsWith(text(["", f("cleanup.group.blocked", { count: 1 }), `- ${f("cleanup.target.run")} ${RUN_D}: ${f("cleanup.blocked.no_result")}`])), shown);
    assert.equal(shown.includes("--confirm"), false, shown);
  });
});

describe("U-86, R-76: the groups over made-up plans", () => {
  test("a plan run that goes with that apply run is under both, with no warning of its own", () => {
    const plan = withFates(
      { ...PLAN_BOTH, items: [...PLAN_BOTH.items, { target: "run", runId: RUN_B, size: { files: 4, bytes: 40 }, warnings: [] }] },
      [{ removedWith: ["include_not_reverted", "delete_discarded"] }, { removedWith: ["delete_discarded"] }, { removedWith: ["include_not_reverted", "delete_discarded"] }],
    );
    const shown = renderCleanup(preview(plan), standIn);
    assert.ok(shown.includes(`${f("cleanup.group.both", { count: 2, files: 6, bytes: 60 })}\n`), shown);
    assert.ok(shown.includes(`  ${f("cleanup.warning.discarded_left")}\n- ${f("cleanup.target.run")} ${RUN_B}: ${f("cleanup.size", { files: 4, bytes: 40 })}\n\n`), shown);
  });
});
