/**
 * Unit U-293 (the CLI migration's C-6a, the third of its five commits; docs/reviews/2026-11-13-cli-migration-plan.md
 * 6.1 to 6.4, PM after p5a's C-6a preparation, U-289 and U-292): the app layer's startRun runs a run's
 * life itself from step 8 on (the model, the cancel source, the assembly, the engine, the notices, the
 * end) instead of borrowing the CLI's runCli. Until U-296 (C-6a's fourth commit) the CLI ran its own
 * (src/cli/run.ts runPrepared), and these cases set the two lives against each other; since then the
 * CLI's run goes through the same life (runCli → runThroughApp → runLife, drawing from onStoredRecord),
 * so they hold that the CLI's wrapper gives on what the life gives, unchanged. Each runs the CLI's run
 * and the app's startRun on the same inputs, in a folder of its own made the same way, and wants the same:
 * - the end summary's counts: the app gives them beside the result (`tally`), counted from the records
 *   as the engine appended them, with the CLI's counting code moved to the app layer; they equal what
 *   runCli's notes give its end summary (info.summary);
 * - what an adapter that draws its own text needs from the handle: the config's language, the default
 *   config location shown, and the run's mask; the language also beside a refusal;
 * - the records as stored, through RunObserver.onStoredRecord (U-292), right after each was stored and
 *   before onEvent gets its copy: drawn with the CLI's renderer and masked with handle.mask, the lines
 *   equal runCli's progress lines, also when registered values lie inside closed words (nc-human's T-3);
 * - a refusal's JSON line: runErrorOutput of the app's error is runCli's output, byte for byte, with its
 *   hint's detail; and runErrorOutput is fromCliError's exact inverse for every error the CLI makes;
 * - the HTTP 404 hint (modelNotFound beside the result) and a cancel through the app's onSignal hook,
 *   which is attached when the cancel source is made (never during the pre-run checks) and detached at
 *   the end.
 * Reproduced first (36d83f7, todo until the app ran its own life). U-307 (ne-verify R-116 I-1): since
 * U-296 the counts, the handle's facts and the notices on both sides come from the same code, so those
 * comparisons are expected values now (each case's counts, the config's language and location, the
 * hint, the progress lines as drawn); a refusal is still held against runCli's JSON line, which the CLI
 * prints from the life's own output while the app hands the same error through fromCliError and
 * runErrorOutput. Temporary folders, scripted models and a fake provider, fake values only; nothing is sent.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { MODEL_NOT_FOUND_HINT, createCodarynApp } from "../../../src/app/index.js";
import type { AppEnvironment, AppError, AppHooks, RunHandle, RunObserver, StartOutcome, StartRunRequest } from "../../../src/app/index.js";
import { appError, fromCliError, runErrorOutput } from "../../../src/app/errors.js";
import { findDefaultConfigLocation } from "../../../src/app/input/config-file.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/app/input/security/index.js";
import { cleanText } from "../../../src/app/input/text-safety.js";
import { cliError, withHint } from "../../../src/app/prepare.js";
import { assembleRun } from "../../../src/app/assembly.js";
import { createHumanOutput } from "../../../src/cli/human/index.js";
import { PROGRESS_PREFIX } from "../../../src/cli/progress.js";
import { runCli } from "../../../src/cli/run.js";
import type { CliEnvironment } from "../../../src/cli/run.js";
import {
  ALL_CLI_ERROR_HINTS,
  ANTHROPIC_API_KEY_ENV,
  CLI_ERROR_EXIT_CODES,
  CLI_ERROR_HINT_DETAIL,
  DETAILED_CLI_ERROR_HINTS,
  PRIVACY_TOKEN_PATTERN_SOURCE,
} from "../../../src/contracts/index.js";
import type { CliErrorCode, InputDiagnostic, JournalEvent, JournalRecord, MaskedText, MessageLanguage, ModelProvider } from "../../../src/contracts/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { FAKE_SECRET, NOTES_RULE, SECRET_ENV, WRITE_NOTES, appEnvironment, readJournal, setupRun, taskRequest } from "./support.js";

const FAKE_KEY = "fake-u293-key-value-0029";
const TOKEN = new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE, "g");
const hooksWith = (hooks: Record<string, unknown>): AppHooks => hooks as unknown as AppHooks;

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/** Two folders made the same way: one for the CLI's life, one for the app's. */
async function pair(files: Record<string, string>, task: Record<string, unknown>, steps: readonly unknown[], more: (base: string) => Promise<void> = async () => {}): Promise<{ readonly cli: string; readonly app: string }> {
  const cli = await setupRun(files, task, steps);
  const app = await setupRun(files, task, steps);
  await more(cli);
  await more(app);
  return { cli, app };
}

/** The CLI's own life in this process: runCli with the real assembly, its progress lines and its renderer in `language`. */
function cliIo(base: string, argv: readonly string[], env: Record<string, string>, language: MessageLanguage, extra: Partial<CliEnvironment> = {}): { readonly io: CliEnvironment; readonly lines: string[] } {
  const lines: string[] = [];
  const messages = createMessageCatalog(language);
  const io: CliEnvironment = {
    argv,
    env: { ...env },
    cwd: base,
    readFile: (file) => readFile(file, "utf8"),
    isDirectory,
    loadEnvFile: () => {
      throw new Error("no variables file in this test");
    },
    locateInWorkspace: (file, root) => locateInWorkspace(file, root),
    relatePaths: (target, at) => relateRealPaths(target, at),
    clock: { now: () => Date.now() },
    randomBytes: (size) => randomBytes(size),
    assemble: assembleRun,
    cancelSignal: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    writeProgress: (line) => lines.push(line),
    human: () => ({ output: createHumanOutput(messages), messages }),
    ...extra,
  };
  return { io, lines };
}

/** An observer that draws each stored record as the CLI's progress lines are drawn (progress.ts withProgress), masked with the handle's mask. */
function drawing(language: MessageLanguage): { readonly observer: RunObserver; readonly lines: string[]; readonly order: string[]; readonly stored: JournalRecord[]; attach(handle: RunHandle): void } {
  const lines: string[] = [];
  const order: string[] = [];
  const stored: JournalRecord[] = [];
  const output = createHumanOutput(createMessageCatalog(language));
  let mask: ((text: string) => MaskedText | null) | undefined;
  const observer: RunObserver = {
    onStoredRecord(record) {
      stored.push(record);
      order.push(`stored ${record.seq}`);
      const drawn = output.progressLine(record as unknown as JournalEvent);
      const each = drawn === null ? [] : typeof drawn === "string" ? [drawn] : drawn;
      for (const line of each) {
        const masked = mask === undefined ? null : mask(`${PROGRESS_PREFIX}${line}`);
        lines.push(masked === null ? "<NOT MASKED>" : `${cleanText(masked)}\n`);
      }
    },
    onEvent(event) {
      if (event.kind === "record") order.push(`event ${event.record.seq}`);
    },
  };
  return { observer, lines, order, stored, attach: (handle) => (mask = handle.mask) };
}

/** Privacy tokens are random per run: each named by the order it first appears, as c01 does. */
function tokensNamed(lines: readonly string[]): string[] {
  const names = new Map<string, string>();
  return lines.map((line) => line.replace(TOKEN, (token) => names.get(token) ?? (names.set(token, `<TOKEN${names.size + 1}>`), names.get(token)!)));
}

function started(outcome: StartOutcome): RunHandle {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { handle: RunHandle }).handle;
}

async function appRun(base: string, request: StartRunRequest, env: Record<string, string>, observer?: RunObserver & { attach?: (handle: RunHandle) => void }, hooks: Record<string, unknown> = {}, more: Partial<AppEnvironment> = {}) {
  const app = createCodarynApp(await appEnvironment(base, { env: { ...env }, ...more }), hooksWith(hooks));
  const outcome = await app.startRun(request, observer);
  if (outcome.ok) observer?.attach?.(outcome.handle);
  return outcome;
}

const ENV = { [SECRET_ENV]: FAKE_SECRET };
const taskArgv = (base: string, ...more: string[]) => ["run", "--task", path.join(base, "task.json"), ...more];

const DENIALS_TASK = { policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, writablePaths: ["NOTES.md"] } };
const DENIALS_STEPS = [
  { toolCalls: [{ name: "run_command", args: { executable: "node", args: ["--version"] } }] },
  { toolCalls: [{ name: "read_file", args: { path: "../outside.txt" } }] },
  { toolCalls: [{ name: "write_file", args: { path: "other.md", expectedHash: null, change: { kind: "replace_all", content: "x\n" } } }] },
  { toolCalls: [{ name: "read_file", args: { path: "missing.md" } }] },
  WRITE_NOTES,
  { text: "done" },
];

const PEOPLE_CSV = ["person,region,amount", ...[1, 2, 3, 4, 5, 6].map((n) => `person-n${n},north,${n * 10}`), ...[1, 2, 3].map((n) => `person-s${n},south,${n * 7}`)].join("\n");
const PRIVATE_TASK = {
  workflow: "analyze",
  workflowRef: "analyze-private",
  policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, unreadablePaths: ["private"] },
  verifiers: [{ id: "report", kind: "file_rules", rules: [{ type: "contains", path: "out/report.md", text: "# Totals" }] }],
};
const PRIVATE_STEPS = [
  { toolCalls: [{ name: "read_file", args: { path: "private/people.csv" } }] },
  { toolCalls: [{ name: "query_table", args: { path: "private/people.csv", groupBy: ["region"], operations: [{ op: "count", column: "person" }, { op: "sum", column: "amount" }] } }] },
  { toolCalls: [{ name: "write_file", args: { path: "out/report.md", expectedHash: null, change: { kind: "replace_all", content: "# Totals\n" } } }] },
  { text: "done" },
];

/** nc-human's T-3 (U-291): registered values inside a write's denial code and a protection check's phase. */
const CLOSED_ENV = { ...ENV, CMP_CLOSED_A: "not_writable", CMP_CLOSED_B: "before_verify" };
const CLOSED_TASK = {
  policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, writablePaths: ["NOTES.md"], protectedPaths: ["README.md"] },
  privacy: { secretEnv: [SECRET_ENV, "CMP_CLOSED_A", "CMP_CLOSED_B"] },
  verifiers: [NOTES_RULE],
};
const CLOSED_STEPS = [{ toolCalls: [{ name: "write_file", args: { path: "other.md", expectedHash: null, change: { kind: "replace_all", content: "x\n" } } }] }, WRITE_NOTES, { text: "done" }];

/** The progress lines of the closed-word run, tokens named by first appearance. */
const EXPECTED_LINES = {
  en: [
    "run started — provider scripted",
    "protected material check — unchanged (run_start)",
    "turn 1",
    "write file — denied (path/path_<TOKEN1>)",
    "turn 2",
    "write file — allowed (write_file)",
    "created NOTES.md",
    "turn 3",
    "check #1 — passed (pass)",
    "finished — done (verified)",
  ],
  ko: [
    "실행 시작 — 모델 제공자 scripted",
    "보호 대상 확인 — 바뀌지 않음 (run_start)",
    "1턴",
    "파일 쓰기 — 거부 (path/path_<TOKEN1>)",
    "2턴",
    "파일 쓰기 — 허용 (write_file)",
    "파일 만듦 NOTES.md",
    "3턴",
    "검증 1번 — 통과 (pass)",
    "끝 — 완료 (verified)",
  ],
} as const;

describe("U-293: the app layer's own run life, and what an adapter that draws its own text gets from it", () => {
  for (const [what, files, task, steps, expected] of [
    ["denials (command, outside, not writable) and a failed call", {}, DENIALS_TASK, DENIALS_STEPS, { deniedToolCalls: 3, deniedCommandCalls: 1, failedToolCalls: 1, deniedNotWritable: 1 }],
    ["a read under the unreadable paths and a table that hid a small group", { "private/people.csv": `${PEOPLE_CSV}\n` }, PRIVATE_TASK, PRIVATE_STEPS, { deniedToolCalls: 1, deniedCommandCalls: 0, failedToolCalls: 0, deniedUnreadable: 1, hiddenGroups: { results: 1, minGroupSize: 5 } }],
    ["registered values inside closed words", { "README.md": "# Readme\n" }, CLOSED_TASK, CLOSED_STEPS, { deniedToolCalls: 1, deniedCommandCalls: 0, failedToolCalls: 0, deniedNotWritable: 1 }],
  ] as const) {
    test(`tally: the end summary's counts beside the result, counted from the records as stored (${what})`, async () => {
      const env = task === CLOSED_TASK ? CLOSED_ENV : ENV;
      const base = await setupRun(files, task, steps);
      const done = await started(await appRun(base, taskRequest(base), env)).done;
      assert.ok(done.ok, JSON.stringify(done));
      assert.deepEqual(done.tally, expected);
    });
  }

  for (const language of ["en", "ko"] as const) {
    test(`progress lines: the stored records drawn with the CLI's renderer and masked with handle.mask, registered values inside closed words too (${language})`, async () => {
      const base = await setupRun({ "README.md": "# Readme\n" }, CLOSED_TASK, CLOSED_STEPS);
      const drawn = drawing(language);
      const handle = started(await appRun(base, taskRequest(base), CLOSED_ENV, { ...drawn.observer, attach: drawn.attach }));
      assert.ok((await handle.done).ok);
      assert.equal(drawn.lines.includes("<NOT MASKED>"), false, "the handle's mask was there for every line");
      // The lines codaryn run draws for this run (nc-human's T-3, pinned for the CLI in u291): the denial's
      // code with the registered value masked in it, and one protection check line before the turns.
      assert.deepEqual(tokensNamed(drawn.lines), EXPECTED_LINES[language].map((line) => `codaryn: ${line}\n`));
      const text = drawn.lines.join("");
      assert.ok(text.includes("path_[[CODARYN_SECRET:"), "the denial line keeps its code with the value masked (T-3)");
      assert.equal(text.includes("not_writable") || text.includes("before_verify"), false, "no registered value is shown");
    });
  }

  test("onStoredRecord: every record as stored, right after it was stored and before onEvent's copy", async () => {
    const base = await setupRun({ "README.md": "# Readme\n" }, CLOSED_TASK, CLOSED_STEPS);
    const drawn = drawing("en");
    const handle = started(await appRun(base, taskRequest(base), CLOSED_ENV, { ...drawn.observer, attach: drawn.attach }));
    assert.ok((await handle.done).ok);
    const journal = await readJournal(base, handle.runId);
    assert.deepEqual(drawn.stored, journal, "the records as journal.jsonl holds them (closed words as written)");
    assert.ok(drawn.stored.some((record) => record.type === "tool_decision" && (record as { code?: string }).code === "path_not_writable"), "a closed word holding a registered value is as written");
    const expected = journal.flatMap((record) => [`stored ${record.seq}`, `event ${record.seq}`]);
    assert.deepEqual(drawn.order, expected);
  });

  test("the handle: the config's language and the default config location shown, known before the first event, and the run's mask", async () => {
    const appData = (base: string) => path.join(base, "appdata");
    const env = (base: string): Record<string, string> => ({ ...ENV, APPDATA: appData(base), XDG_CONFIG_HOME: appData(base) });
    const base = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const location = findDefaultConfigLocation(process.platform, env(base), null);
    assert.ok(location !== null);
    await mkdir(path.dirname(location.path), { recursive: true });
    await writeFile(location.path, JSON.stringify({ schemaVersion: 1, language: "ko" }), "utf8");
    const handle = started(await appRun(base, taskRequest(base), env(base)));
    const facts = handle;
    assert.deepEqual([facts.configLanguage, facts.defaultConfig], ["ko", location.display], "the config's language, the location's fixed display (N-1, N-14)");
    const masked = facts.mask?.(`token: ${FAKE_SECRET}`) ?? null;
    assert.ok(masked !== null && !masked.includes(FAKE_SECRET) && new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE).test(masked), String(masked));
    assert.equal(facts.mask?.("nothing to hide"), "nothing to hide");
    assert.ok((await handle.done).ok);
  });

  const lockOf = (base: string) => writeFile(path.join(base, "work", ".codaryn", "lock.json"), JSON.stringify({ pid: process.pid, runId: "20200101T000000Z-0000beef", startedAt: "2020-01-01T00:00:00.000Z" }), "utf8");
  for (const [what, task, more, withConfig, language] of [
    ["a script file that is missing", { model: { provider: "scripted", scriptPath: "./no-such-script.json" } }, async () => {}, true, "ko"],
    ["a script file with a JSON syntax error", { model: { provider: "scripted", scriptPath: "./bad-script.json" } }, async (base: string) => writeFile(path.join(base, "bad-script.json"), '{ "schemaVersion": 1, "steps": [', "utf8"), true, "ko"],
    ["a script step with an unknown field", { model: { provider: "scripted", scriptPath: "./odd-script.json" } }, async (base: string) => writeFile(path.join(base, "odd-script.json"), JSON.stringify({ schemaVersion: 1, steps: [{ text: "x", unknownField: 1 }] }), "utf8"), true, "ko"],
    ["a workspace another live process holds", {}, async (base: string) => (await mkdir(path.join(base, "work", ".codaryn"), { recursive: true }), lockOf(base)), true, "ko"],
    // The task file is read before the config, so its refusal comes with no language.
    ["a task file with a JSON syntax error", {}, async (base: string) => writeFile(path.join(base, "task.json"), '{ "schemaVersion": 1, "id": ', "utf8"), true, undefined],
  ] as const) {
    test(`a refusal: the app's error prints as runCli's JSON line (runErrorOutput), the config's language beside it (${what})`, async () => {
      const bases = await pair({}, task, [{ text: "done" }], async (base) => {
        await more(base);
        await writeFile(path.join(base, "ko-config.json"), JSON.stringify({ schemaVersion: 1, language: "ko" }), "utf8");
      });
      const config = (base: string) => (withConfig ? ["--config", path.join(base, "ko-config.json")] : []);
      const cli = await runCli(cliIo(bases.cli, taskArgv(bases.cli, ...config(bases.cli)), ENV, "ko").io);
      assert.equal(cli.output.kind, "error", JSON.stringify(cli.output));
      const outcome = await appRun(bases.app, taskRequest(bases.app, { configPath: withConfig ? path.join(bases.app, "ko-config.json") : null }), ENV);
      assert.equal(outcome.ok, false, JSON.stringify(outcome));
      const failure = outcome as { error: AppError; configLanguage?: MessageLanguage };
      assert.equal(failure.configLanguage, language, "the config's language beside the refusal (absent when the config was not read)");
      const printed = runErrorOutput(failure.error);
      const at = (text: string, base: string) => text.split(base).join("<BASE>").split(base.split("\\").join("\\\\")).join("<BASE>");
      assert.equal(at(JSON.stringify(printed), bases.app), at(JSON.stringify(cli.output), bases.cli));
      assert.deepEqual(Object.keys(printed), Object.keys(cli.output));
      assert.deepEqual(printed[CLI_ERROR_HINT_DETAIL], cli.output.kind === "error" ? cli.output[CLI_ERROR_HINT_DETAIL] : undefined);
    });
  }

  test("runErrorOutput is fromCliError's exact inverse for every error the CLI makes, and gives an app-made error the CLI's form", () => {
    const diagnostics: (InputDiagnostic | undefined)[] = [undefined, { code: "json_syntax", file: "config", field: null, line: 1, column: 2 }];
    let checked = 0;
    for (const code of Object.keys(CLI_ERROR_EXIT_CODES) as CliErrorCode[]) {
      for (const diagnostic of diagnostics) {
        for (const hint of [null, ...ALL_CLI_ERROR_HINTS]) {
          const made = cliError(code, "a fixed message", diagnostic);
          const detail = hint !== null && (DETAILED_CLI_ERROR_HINTS as readonly string[]).includes(hint) ? { position: 2 } : undefined;
          const output = hint === null ? made.output : withHint(made, hint, detail).output;
          const again = runErrorOutput(fromCliError(output));
          assert.equal(JSON.stringify(again), JSON.stringify(output), `${code} ${hint}`);
          assert.deepEqual(Object.keys(again), Object.keys(output), `${code} ${hint}`);
          assert.deepEqual(again[CLI_ERROR_HINT_DETAIL], output[CLI_ERROR_HINT_DETAIL], `${code} ${hint}`);
          checked += 1;
        }
      }
      assert.equal(JSON.stringify(runErrorOutput(appError(code, "made by the app"))), JSON.stringify(cliError(code, "made by the app").output), code);
    }
    assert.ok(checked > 100, String(checked));
  });

  test("modelNotFound: a request answered with HTTP 404 ends with the hint's notice, and modelNotFound beside the result", async () => {
    const task = { model: { provider: "anthropic", model: "fake-model-gone", maxOutputTokens: 100 }, limits: { maxModelTurns: 2, maxToolCalls: 2, maxTotalTokens: 1000, maxDurationMs: 60_000 } };
    const provider: ModelProvider = { name: "anthropic", complete: async () => ({ ok: false, kind: "api_error", message: "HTTP 404 not_found_error", httpStatus: 404 }) };
    const env = { ...ENV, [ANTHROPIC_API_KEY_ENV]: FAKE_KEY };
    const base = await setupRun({}, task, []);
    const handle = started(await appRun(base, taskRequest(base), env, undefined, { createAnthropicProvider: () => provider }));
    const done = await handle.done;
    assert.ok(done.ok, JSON.stringify(done));
    assert.deepEqual([done.result.status, done.result.reason], ["failed", "model_error"]);
    assert.equal(done.result.notices.at(-1), MODEL_NOT_FOUND_HINT, "the hint's notice, in English, last");
    assert.equal(done.modelNotFound, true);
    const scripted = await setupRun({}, {}, [WRITE_NOTES, { text: "done" }]);
    const plain = await started(await appRun(scripted, taskRequest(scripted), ENV)).done;
    assert.ok(plain.ok && plain.tally !== undefined, "the outcome has its counts");
    assert.equal("modelNotFound" in plain, false, "absent when no request was answered with 404");
  });

  test("onSignal: attached when the cancel source is made, never during the pre-run checks, detached at the end; its handler cancels the run", async () => {
    const calls: string[] = [];
    const handlers = new Map<string, () => void>();
    const onSignal = (name: "SIGINT" | "SIGTERM", handler: () => void) => {
      calls.push(`on ${name}`);
      handlers.set(name, handler);
      return () => calls.push(`off ${name}`);
    };
    const refused = await setupRun({}, { model: { provider: "scripted", scriptPath: "./no-such-script.json" } }, []);
    const bad = await setupRun({}, {}, []);
    await writeFile(path.join(bad, "task.json"), "{ not json", "utf8");
    assert.equal((await appRun(bad, taskRequest(bad), ENV, undefined, {}, { onSignal })).ok, false);
    assert.deepEqual(calls, [], "a refusal in the pre-run checks attaches nothing");
    assert.equal((await appRun(refused, taskRequest(refused), ENV, undefined, {}, { onSignal })).ok, false);
    assert.deepEqual(calls, [], "nor does a script refused at step 8, before the cancel source");
    const base = await setupRun({}, {}, [{ text: "waiting", delayMs: 30_000 }, { text: "done" }]);
    const handle = started(await appRun(base, taskRequest(base), ENV, undefined, {}, { onSignal }));
    assert.deepEqual(calls, ["on SIGINT", "on SIGTERM"], "attached before the handle came, as the CLI's are before its assembly");
    handlers.get("SIGINT")?.();
    const done = await handle.done;
    assert.ok(done.ok);
    assert.equal(done.result.status, "cancelled");
    assert.deepEqual(calls, ["on SIGINT", "on SIGTERM", "off SIGINT", "off SIGTERM"], "detached at the end");
  });
});
