/**
 * Unit U-313 (the CLI migration's C-7b; plan 6.1, 6.2, 6.4; PM D-2): the app layer's apply life
 * (applyLife, src/app/apply-life.ts) against the CLI's own apply (runApply, src/cli/plan-commands.ts),
 * while both lives exist. Nothing calls applyLife yet; na-core's switch makes the CLI and the app's
 * applyPlan call it. Each case makes the same plan in two folders with the same clock and the same
 * random bytes, so run ids and digests are the same, then applies it once with runApply and once with
 * applyLife whose hooks draw as the CLI draws (`cliDrawing` below: the CLI's own question, line and
 * summary functions, on what the hooks give). What must be the same: the JSON line, the records, and
 * the questions and lines a person sees, in their order (na-core's report §145: the masking is the plan
 * view's gateway itself, so the tokens are the same; the other-task notice in its places; a run plan's
 * run drawn from runReady and its stored records).
 * Once the switch has made the two one code, these comparisons are to become expected values (ne-verify
 * R-116 I-1). Temporary folders, scripted models, fake values, U-312's file system faults; nothing is sent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { applyLife } from "../../../src/app/apply-life.js";
import type { ApplyLifeEnvironment, ApplyLifeAdapter } from "../../../src/app/apply-life.js";
import { assembleRun } from "../../../src/app/assembly.js";
import type { CommandOutcome } from "../../../src/app/command-outcome.js";
import { prepareFor } from "../../../src/app/plan-view.js";
import { cleanText } from "../../../src/app/input/text-safety.js";
import { knownKeyValues } from "../../../src/app/input/settings.js";
import type { ApplyFacts, ApplyLifeHooks } from "../../../src/contracts/app.js";
import { PRIVACY_TOKEN_PATTERN_SOURCE } from "../../../src/contracts/index.js";
import type { ApplyJournalRecord, ApplyPlan, EngineResult, HumanOutput, JournalRecord, MessageCatalog, MessageLanguage } from "../../../src/contracts/index.js";
import { parseApplyArgs } from "../../../src/cli/args.js";
import { changesApplyQuestion, changesApprovalText, createHumanOutput, renderChangesPlan } from "../../../src/cli/human/index.js";
import { applyQuestion, renderPlan, runApply, unsafeMoveQuestion } from "../../../src/cli/plan-commands.js";
import type { ApplyCommandEnvironment } from "../../../src/cli/plan-commands.js";
import { PROGRESS_PREFIX } from "../../../src/cli/progress.js";
import { runCli } from "../../../src/cli/run.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { installFsFaults } from "../../support/fs-faults.js";

const SECRET_ENV = "CODARYN_U313_SECRET";
const FAKE_SECRET = "fake-secret-U313-VALUE-0042";
const YES = new Set(["y", "yes", "예", "네"]);
const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});

const policy = (planActions?: readonly string[]) => ({ commands: [], network: "deny", destructive: "deny", restorePathTokens: false, ...(planActions === undefined ? {} : { planActions }) });
const limits = { maxModelTurns: 6, maxToolCalls: 10, maxTotalTokens: null, maxDurationMs: 60_000 };
/** A plan of moves (the built-in organize workflow): a move whose names hold the registered value, and a discard. */
const MOVES_TASK = { schemaVersion: 1, id: "u313-moves", goal: "Sort the inbox.", workflow: "u313", workflowRef: "organize", workspaceRoot: "./work", model: { provider: "scripted", scriptPath: "./script.json" }, policy: policy(["move", "discard"]), privacy: { secretEnv: [SECRET_ENV] }, limits, verifiers: [] };
const MOVES_FILES = { "inbox/a.txt": "alpha\n", [`inbox/key-${FAKE_SECRET}.txt`]: "key\n", "inbox/old.tmp": "old\n" };
const MOVES_SCRIPT = {
  schemaVersion: 1,
  steps: [
    {
      toolCalls: [
        {
          name: "propose_plan",
          args: {
            summary: "Sort the inbox",
            actions: [
              { kind: "move", from: "inbox/a.txt", to: "sorted/a.txt" },
              { kind: "move", from: `inbox/key-${FAKE_SECRET}.txt`, to: `sorted/key-${FAKE_SECRET}.txt` },
              { kind: "discard", path: "inbox/old.tmp" },
            ],
          },
        },
      ],
    },
  ],
};
/** A run plan (a config's workflow with plan "run"): the plan proposes summary.md; its carrying run reads and writes it. */
const RUN_PLAN_CONFIG = { schemaVersion: 1, workflows: { rewrite: { tools: ["read_file", "search_files", "write_file", "propose_changes"], plan: "run" } } };
const RUN_PLAN_TASK = { ...MOVES_TASK, id: "u313-run-plan", goal: "Write a summary of notes.md into summary.md.", workflowRef: "rewrite", policy: policy(), verifiers: [{ id: "summary", kind: "file_rules", rules: [{ type: "contains", path: "summary.md", text: "## Decisions" }] }] };
const RUN_PLAN_SCRIPT = { schemaVersion: 1, steps: [{ toolCalls: [{ name: "propose_changes", args: { summary: "Add the summary", files: [{ path: "summary.md", change: "create" }] } }] }, { text: "The plan is proposed." }] };
const CARRYING_SCRIPT = {
  schemaVersion: 1,
  steps: [
    { toolCalls: [{ name: "read_file", args: { path: "notes.md" } }] },
    { toolCalls: [{ name: "write_file", args: { path: "summary.md", expectedHash: null, change: { kind: "replace_all", content: "# Summary\n\n## Decisions\n" } } }] },
    { text: "The summary is written." },
  ],
};

/** One folder of a comparison: its own fake clock and random bytes, the same in both folders of a case. */
interface Box {
  readonly base: string;
  readonly real: string;
  readonly clock: { now(): number };
  readonly randomBytes: (size: number) => Uint8Array;
  readonly lines: string[];
  /** Privacy tokens named by first appearance in this folder (each gateway has its own key). */
  readonly tokens: Map<string, string>;
}

const START = Date.now() - 3_600_000;
async function newBox(root: string, name: string, kind: "moves" | "run-plan"): Promise<Box> {
  const base = path.join(root, name);
  await mkdir(path.join(base, "work"), { recursive: true });
  let now = START;
  let seed = 7;
  const box: Box = {
    base,
    real: await realpath(base),
    clock: { now: () => (now += 1000) },
    randomBytes: (size) => new Uint8Array(size).fill(seed++ % 250),
    lines: [],
    tokens: new Map(),
  };
  const files: Record<string, string> = kind === "moves" ? MOVES_FILES : { "notes.md": "# Weekly notes\n\n- The site moves next week.\n" };
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(base, "work", file)), { recursive: true });
    await writeFile(path.join(base, "work", file), content, "utf8");
  }
  const task = kind === "moves" ? MOVES_TASK : RUN_PLAN_TASK;
  await writeFile(path.join(base, "task.json"), JSON.stringify(task), "utf8");
  await writeFile(path.join(base, "other-task.json"), JSON.stringify({ ...task, id: `${task.id}-other` }), "utf8");
  await writeFile(path.join(base, "noplan-task.json"), JSON.stringify({ ...task, id: "u313-noplan", workflowRef: undefined, workflow: "u313" }), "utf8");
  await writeFile(path.join(base, "config.json"), JSON.stringify(RUN_PLAN_CONFIG), "utf8");
  await writeFile(path.join(base, "script.json"), JSON.stringify(kind === "moves" ? MOVES_SCRIPT : RUN_PLAN_SCRIPT), "utf8");
  return box;
}

/** Two folders under one root (so U-312's faults can name both), each with the plan run made. Returns the plan run's id and digest. */
async function pair(kind: "moves" | "run-plan"): Promise<{ readonly root: string; readonly old: Box; readonly fresh: Box; readonly planRunId: string; readonly digest: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "codaryn-u313-"));
  temporaryDirs.push(root);
  const old = await newBox(root, "old", kind);
  const fresh = await newBox(root, "new", kind);
  const made: EngineResult[] = [];
  for (const box of [old, fresh]) {
    const argv = ["run", "--task", "task.json", "--quiet", ...(kind === "run-plan" ? ["--config", "config.json"] : [])];
    const outcome = await runCli({ ...shared(box, argv), assemble: assembleRun });
    assert.equal(outcome.output.kind, "run", JSON.stringify(outcome.output));
    made.push(outcome.output as EngineResult);
  }
  assert.deepEqual(made.map((one) => [one.reason, one.runId, one.plan?.digest]), [made[0]!, made[0]!].map((one) => [one.reason, one.runId, one.plan?.digest]));
  assert.equal(made[0]!.reason, "plan_pending");
  if (kind === "run-plan") for (const box of [old, fresh]) await writeFile(path.join(box.base, "script.json"), JSON.stringify(CARRYING_SCRIPT), "utf8");
  return { root, old, fresh, planRunId: made[0]!.runId, digest: made[0]!.plan?.digest ?? "" };
}

const isDirectory = async (dir: string): Promise<boolean> => (await stat(dir).catch(() => null))?.isDirectory() ?? false;

/** What both lives are given, as the CLI's main gives it (env with the registered value). */
function shared(box: Box, argv: readonly string[]) {
  return {
    argv,
    env: { [SECRET_ENV]: FAKE_SECRET },
    cwd: box.base,
    readFile: (file: string) => readFile(file, "utf8"),
    isDirectory,
    loadEnvFile: () => {},
    locateInWorkspace: (file: string, root: string) => locateInWorkspace(file, root),
    relatePaths: (target: string, root: string) => relateRealPaths(target, root),
    clock: box.clock,
    randomBytes: box.randomBytes,
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
  };
}

interface Way {
  readonly lang?: MessageLanguage;
  /** Answers typed at the terminal, in order; absent: not at a terminal. */
  readonly answers?: readonly string[];
  readonly quiet?: boolean;
  readonly adapter?: ApplyLifeAdapter;
  readonly applyPlan?: ApplyPlan;
  readonly run?: boolean;
}

/** The terminal of a box: each question is a line of the box's transcript, then the next answer. */
function terminal(box: Box, answers: readonly string[] | undefined): ((question: string) => Promise<string | null>) | undefined {
  if (answers === undefined) return undefined;
  const left = [...answers];
  return async (question) => {
    box.lines.push(`? ${question}`);
    return left.shift() ?? null;
  };
}

function rendering(lang: MessageLanguage): { readonly messages: MessageCatalog; readonly human: HumanOutput } {
  const messages = createMessageCatalog(lang);
  return { messages, human: createHumanOutput(messages) };
}

/** The CLI's own apply (runApply) in `box`. */
async function oldApply(box: Box, argv: readonly string[], way: Way = {}): Promise<CommandOutcome> {
  const { messages, human } = rendering(way.lang ?? "en");
  const ask = terminal(box, way.answers);
  const io: ApplyCommandEnvironment = {
    ...shared(box, argv),
    messages,
    human,
    writeProgress: (line) => box.lines.push(line),
    ...(ask === undefined ? {} : { ask }),
    ...(way.adapter === undefined ? {} : { adapter: way.adapter }),
    ...(way.applyPlan === undefined ? {} : { applyPlan: way.applyPlan }),
    ...(way.run === true ? { run: { ...shared(box, argv), assemble: assembleRun } } : {}),
  };
  return runApply(io);
}

/**
 * The hooks as the CLI is to give them (na-core's switch): its question, line and summary functions on
 * what the hooks give, writing to the box's transcript as runApply writes. `calls` names each hook in order.
 */
function cliDrawing(box: Box, way: Way, calls: string[]): ApplyLifeHooks {
  const { messages, human } = rendering(way.lang ?? "en");
  const ask = terminal(box, way.answers);
  const write = way.quiet === true ? undefined : (line: string) => box.lines.push(line);
  let facts: ApplyFacts | null = null;
  const otherTaskLine = (): string => messages.format("apply.notice.plan_task_differs");
  const yes = async (question: string): Promise<boolean> => YES.has((await ask!(question))?.trim().toLowerCase() ?? "");
  return {
    ready(given) {
      calls.push(`ready ${given.planKind}${given.otherTask ? " other-task" : ""}`);
      facts = given;
    },
    ...(ask === undefined
      ? {}
      : {
          async approve(view) {
            calls.push(`approve ${view.kind}`);
            const other = facts?.otherTask === true ? [otherTaskLine()] : [];
            const parts =
              view.kind === "moves"
                ? [renderPlan(view.plan, knownKeyValues(shared(box, []).env), messages).trimEnd(), ...other, applyQuestion(messages)]
                : [
                    renderChangesPlan(view.plan, knownKeyValues(shared(box, []).env), messages).trimEnd(),
                    ...other,
                    changesApprovalText(view.plan, { commandsAllowed: view.commandsAllowed }, messages).trimEnd(),
                    changesApplyQuestion(messages),
                  ];
            return yes(parts.join("\n"));
          },
          async consentToUnsafeMoves(count) {
            calls.push(`consent ${count}`);
            return yes(unsafeMoveQuestion(count, messages));
          },
        }),
    observer: {
      onStoredRecord(record: ApplyJournalRecord) {
        calls.push(`record ${record.type}`);
        if (write === undefined || facts === null) return;
        const lines: string[] = [];
        const line = human.applyProgressLine?.(record) ?? null;
        if (line !== null) lines.push(line);
        if (record.type === "apply_started" && facts.otherTask) lines.push(otherTaskLine());
        for (const one of lines) {
          const masked = facts.mask(`${PROGRESS_PREFIX}${one}`);
          if (masked !== null) write(`${cleanText(masked)}\n`);
        }
      },
      onStoredRunRecord(record: JournalRecord) {
        calls.push(`run-record ${record.type}`);
      },
    },
    applyEnded(end) {
      calls.push(`ended ${end.result.reason}${end.lockLeft ? " lock-left" : ""}`);
      if (write === undefined || facts === null || human.applySummary === undefined) return;
      const summary = human.applySummary(end.result, { workspaceForm: "task", ...(end.lockLeft ? { lockLeft: true } : {}) });
      const masked = facts.mask(summary);
      if (masked !== null) write(cleanText(masked, true));
    },
    runReady(given) {
      calls.push(`run-ready ${given.runId}`);
    },
  };
}

/** The app layer's apply life in `box`, as the CLI is to call it (the arguments parsed, prepareFor, then the life). */
async function lifeApply(box: Box, argv: readonly string[], way: Way = {}, calls: string[] = []): Promise<CommandOutcome> {
  const parsed = parseApplyArgs(argv);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const io: ApplyLifeEnvironment = {
    ...shared(box, argv),
    ...(way.adapter === undefined ? {} : { adapter: way.adapter }),
    ...(way.applyPlan === undefined ? {} : { applyPlan: way.applyPlan }),
    ...(way.run === true ? { run: { ...shared(box, argv), assemble: assembleRun } } : {}),
  };
  const ready = await prepareFor(io, parsed.args.form, parsed.args.runId, parsed.args.cancelFile, parsed.args.quiet);
  if (!ready.ok) return ready.outcome;
  const end = await applyLife(io, parsed.args, ready.value, cliDrawing(box, way, calls));
  if (end.kind === "error") return end.outcome;
  if (end.kind === "applied") return { output: end.result, exitCode: end.result.exitCode };
  // A run plan: as the CLI prints a run's end (runThroughApp): the refusal's line, or the result.
  if (end.end.kind === "refused") return { output: end.end.output, exitCode: end.end.output.exitCode };
  return { output: end.end.result, exitCode: end.end.result.exitCode };
}

/**
 * A text with the box's folder named <BASE> (as written, real, and inside JSON), and each privacy token
 * named by its first appearance in the box: the same token is the same name in its JSON line, its lines
 * and its records, so the comparison holds that the life masks with the same gateway runApply did.
 */
function normal(box: Box, text: string): string {
  let out = text;
  for (const form of [box.real, box.base]) {
    for (const shown of [form, JSON.stringify(form).slice(1, -1)]) out = out.split(shown).join("<BASE>");
  }
  return out.replace(new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE, "g"), (token) => {
    const known = box.tokens.get(token);
    if (known !== undefined) return known;
    const name = `<TOKEN-${box.tokens.size + 1}>`;
    box.tokens.set(token, name);
    return name;
  });
}

/** Every file under work/, its path and text, the box's folder named <BASE>. */
async function filesOf(box: Box): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(`${path.relative(box.base, full).split(path.sep).join("/")}: ${normal(box, await readFile(full, "utf8"))}`);
    }
  };
  await walk(path.join(box.base, "work"));
  return out;
}

/** Where two texts first differ, with some text around it (for the assertion's message). */
function firstDifference(actual: string, expected: string): string {
  let index = 0;
  while (index < actual.length && actual[index] === expected[index]) index += 1;
  return `at ${index}: life …${actual.slice(Math.max(0, index - 60), index + 80)}… runApply …${expected.slice(Math.max(0, index - 60), index + 80)}…`;
}

/** The same JSON line, records and transcript in both folders. */
async function same(old: Box, fresh: Box, before: CommandOutcome, now: CommandOutcome): Promise<void> {
  const line = normal(fresh, JSON.stringify(now));
  const oldLine = normal(old, JSON.stringify(before));
  assert.equal(line, oldLine, `the JSON line and exit code ${firstDifference(line, oldLine)}`);
  assert.deepEqual(fresh.lines.map((line) => normal(fresh, line)), old.lines.map((line) => normal(old, line)), "the questions and lines, in order");
  assert.deepEqual(await filesOf(fresh), await filesOf(old), "the records and the workspace");
}

const applyArgv = (planRunId: string, ...more: string[]): string[] => ["apply", "--task", "task.json", "--run", planRunId, ...more];

describe("U-313: the app's apply life against the CLI's runApply", () => {
  test("a plan of moves at a terminal and by --digest: the same result, records, question and lines, the tokens of the plan view's gateway", async () => {
    const ways: Way[] = [{ answers: ["y"] }, { lang: "ko", answers: ["y"] }, {}];
    for (const way of ways) {
      const { old, fresh, planRunId, digest } = await pair("moves");
      const argv = way.answers === undefined ? applyArgv(planRunId, "--digest", digest.slice(0, 12)) : applyArgv(planRunId);
      const calls: string[] = [];
      await same(old, fresh, await oldApply(old, argv, way), await lifeApply(fresh, argv, way, calls));
      assert.equal(calls[0], "ready moves");
      if (way.answers !== undefined) assert.equal(calls[1], "approve moves");
      assert.equal(calls.at(-1), "ended verified");
      // na-core's (c): the moved names are shown masked, with the tokens runApply's lines have (same() compared them).
      const shown = fresh.lines.join("");
      assert.equal(shown.includes(FAKE_SECRET), false, "the registered value is not shown");
      assert.match(shown, new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE));
    }
  });

  test("the refusals before anything is moved, and an adapter's: the same error JSON", async () => {
    const { old, fresh, planRunId, digest } = await pair("moves");
    const prefix = digest.slice(0, 12);
    const markDir = (box: Box) => path.join(box.base, "work", ".codaryn", "runs", planRunId);
    const lockFile = (box: Box) => path.join(box.base, "work", ".codaryn", "lock.json");
    const cases: { readonly name: string; readonly argv: string[]; readonly way?: Way; readonly before?: (box: Box) => Promise<void>; readonly after?: (box: Box) => Promise<void>; readonly code: string }[] = [
      { name: "a digest that is not the plan's", argv: applyArgv(planRunId, "--digest", "000000000000"), code: "plan_not_approved" },
      { name: "no digest, not at a terminal", argv: applyArgv(planRunId), code: "plan_not_approved" },
      { name: "a task with no plan mode", argv: ["apply", "--task", "noplan-task.json", "--run", planRunId, "--digest", prefix], code: "run_not_plan" },
      {
        name: "a records-changed mark",
        argv: applyArgv(planRunId, "--digest", prefix),
        before: (box) => writeFile(path.join(markDir(box), "records-changed.json"), "{}", "utf8"),
        after: (box) => rm(path.join(markDir(box), "records-changed.json"), { force: true }),
        code: "plan_records_changed",
      },
      {
        name: "a held lock",
        argv: applyArgv(planRunId, "--digest", prefix),
        before: (box) => writeFile(lockFile(box), JSON.stringify({ pid: process.pid, runId: "20200101T000000Z-0000beef", startedAt: "2020-01-01T00:00:00.000Z" }), "utf8"),
        after: (box) => rm(lockFile(box), { force: true }),
        code: "workspace_locked",
      },
      { name: "an adapter's consent argument", argv: applyArgv(planRunId, "--digest", prefix, "--allow-unsafe-move"), way: { adapter: { unsafeMoveConsent: null } }, code: "invalid_arguments" },
      { name: "an adapter's consent for another digest", argv: applyArgv(planRunId, "--digest", prefix), way: { adapter: { unsafeMoveConsent: { channel: "adapter", digest: "0".repeat(64) } } }, code: "invalid_arguments" },
      { name: "applied once", argv: applyArgv(planRunId, "--digest", prefix), code: "applied" },
      { name: "applied already", argv: applyArgv(planRunId, "--digest", prefix), code: "plan_already_applied" },
    ];
    for (const one of cases) {
      await one.before?.(old);
      const before = await oldApply(old, one.argv, one.way);
      await one.after?.(old);
      await one.before?.(fresh);
      const now = await lifeApply(fresh, one.argv, one.way);
      await one.after?.(fresh);
      const output = "output" in now ? (now.output as { readonly kind: string; readonly code?: string }) : null;
      assert.equal(output?.kind === "error" ? output.code : "applied", one.code, `${one.name}: ${JSON.stringify(now)}`);
      assert.equal(normal(fresh, JSON.stringify(now)), normal(old, JSON.stringify(before)), one.name);
    }
    assert.deepEqual(await filesOf(fresh), await filesOf(old));
  });

  test("DR-21 on a volume without hard links (U-312's faults): yes makes a second apply run, no keeps the first; and a lock that cannot be released", async () => {
    const ways: Way[] = [{ answers: ["y", "y"] }, { answers: ["y", "n"] }, { lang: "ko", answers: ["y", "y"] }];
    for (const way of ways) {
      const { root, old, fresh, planRunId } = await pair("moves");
      const faults = installFsFaults({ noLinksUnder: root });
      try {
        const calls: string[] = [];
        await same(old, fresh, await oldApply(old, applyArgv(planRunId), way), await lifeApply(fresh, applyArgv(planRunId), way, calls));
        const consented = way.answers?.[1] === "y";
        // The hooks in the order of runApply's lines: the first apply's summary before the question.
        const order = calls.filter((call) => !call.startsWith("record"));
        // Three unsafe items: the two moves and the discard (each a move without a hard link).
        assert.deepEqual(order, ["ready moves", "approve moves", "ended consent_required", "consent 3", ...(consented ? ["ended verified"] : [])]);
        assert.ok(faults.counts.links > 0, "the moves met the fault");
      } finally {
        faults.remove();
      }
    }
    const { old, fresh, planRunId, digest } = await pair("moves");
    const calls: string[] = [];
    const outcomes: CommandOutcome[] = [];
    for (const box of [old, fresh]) {
      const faults = installFsFaults({ failLockRemoval: path.join(box.base, "work", ".codaryn", "lock.json") });
      try {
        const argv = applyArgv(planRunId, "--digest", digest.slice(0, 12));
        outcomes.push(box === old ? await oldApply(box, argv) : await lifeApply(box, argv, {}, calls));
        assert.ok(faults.counts.removals > 0, "the release met the fault");
      } finally {
        faults.remove();
      }
    }
    await same(old, fresh, outcomes[0]!, outcomes[1]!);
    assert.equal(calls.at(-1), "ended verified lock-left");
    assert.equal(JSON.stringify(outcomes[1]).includes("lockLeft"), false, "the JSON line has no lockLeft (PM D-3)");
  });

  test("the other-task notice: in a plan of moves' question and right after its start; a run plan's before its run", async () => {
    const moves = await pair("moves");
    const argv = ["apply", "--task", "other-task.json", "--run", moves.planRunId];
    const calls: string[] = [];
    await same(moves.old, moves.fresh, await oldApply(moves.old, argv, { answers: ["y"] }), await lifeApply(moves.fresh, argv, { answers: ["y"] }, calls));
    assert.equal(calls[0], "ready moves other-task");
    const notice = createMessageCatalog("en").format("apply.notice.plan_task_differs");
    const places = moves.fresh.lines.flatMap((line, index) => (line.includes(notice) ? [index] : []));
    // The CLI's two places, then the engine's own notice in the end summary (U-16, unchanged).
    assert.equal(places.length, 3, moves.fresh.lines.join(""));
    assert.ok(moves.fresh.lines[places[0]!]!.startsWith("? "), "inside the question");
    assert.match(moves.fresh.lines[places[1]! - 1]!, /apply started/, "right after the apply's start line");
    assert.match(moves.fresh.lines[places[2]!]!, /── Result/, "the engine's notice in the summary");

    // A run plan: the notice is told before its run; runReady comes after the approval and before the
    // run's first record. Refused after the approval (a held lock), no runReady comes and the error is
    // not plan_not_approved: the CLI writes the notice then (the head of apply-life.ts).
    const plan = await pair("run-plan");
    const runArgv = ["apply", "--task", "other-task.json", "--config", "config.json", "--run", plan.planRunId, "--digest", plan.digest.slice(0, 12)];
    const lockFile = path.join(plan.fresh.base, "work", ".codaryn", "lock.json");
    await writeFile(lockFile, JSON.stringify({ pid: process.pid, runId: "20200101T000000Z-0000beef", startedAt: "2020-01-01T00:00:00.000Z" }), "utf8");
    const refusedCalls: string[] = [];
    const refused = await lifeApply(plan.fresh, runArgv, { run: true, quiet: true }, refusedCalls);
    await rm(lockFile, { force: true });
    assert.equal("output" in refused && (refused.output as { readonly code?: string }).code, "workspace_locked");
    assert.deepEqual(refusedCalls, ["ready changes other-task"]);
    const runCalls: string[] = [];
    const ran = await lifeApply(plan.fresh, runArgv, { run: true, quiet: true }, runCalls);
    assert.equal("output" in ran && (ran.output as EngineResult).reason, "verified", JSON.stringify(ran));
    assert.equal(runCalls[0], "ready changes other-task");
    assert.match(runCalls[1] ?? "", /^run-ready /);
    assert.equal(runCalls[2], "run-record run_started");
  });

  test("a run plan carried by runLife: the same result and records as the CLI's, runReady once before its first record, its records as stored", async () => {
    const { old, fresh, planRunId, digest } = await pair("run-plan");
    const argv = ["apply", "--task", "task.json", "--config", "config.json", "--run", planRunId, "--digest", digest.slice(0, 12), "--quiet"];
    const calls: string[] = [];
    const before = await oldApply(old, argv, { run: true });
    const now = await lifeApply(fresh, argv, { run: true, quiet: true }, calls);
    await same(old, fresh, before, now);
    const result = (now as { readonly output: EngineResult }).output;
    assert.equal(result.reason, "verified", JSON.stringify(result));
    assert.equal(result.planRunId, planRunId);
    assert.deepEqual(calls.slice(0, 2), ["ready changes", `run-ready ${result.runId}`]);
    assert.equal(calls.filter((call) => call.startsWith("run-ready")).length, 1);
    const journal = (await readFile(path.join(fresh.base, "work", ".codaryn", "runs", result.runId, "journal.jsonl"), "utf8")).split("\n").filter((line) => line.length > 0);
    assert.deepEqual(
      calls.filter((call) => call.startsWith("run-record")),
      journal.map((line) => `run-record ${(JSON.parse(line) as JournalRecord).type}`),
      "every record, as stored, in order",
    );
    // Applied again with the consent argument (which is for a plan of moves): refused alike.
    const consentArgv = [...argv.slice(0, -1), "--allow-unsafe-move"];
    assert.equal(normal(fresh, JSON.stringify(await lifeApply(fresh, consentArgv, { run: true }))), normal(old, JSON.stringify(await oldApply(old, consentArgv, { run: true }))));
  });
});
