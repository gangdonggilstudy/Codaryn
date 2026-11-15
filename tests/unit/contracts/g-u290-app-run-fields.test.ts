/**
 * U-290 (C-6a, the CLI migration, DR-65): the app layer's new run fields are types of its own contract
 * (src/contracts/app.ts) and never reach a run's result, result.json or `codaryn run --json`. These
 * are the end summary's counts (RunTally, beside the result), the Y-4 mark, what a run's handle tells
 * its adapter (configLanguage, defaultConfig, mask), a refusal's language and the signal hook.
 * - By type: RunTally's fields are RunSummaryContext's own, of types it takes, so a count keeps one
 *   meaning. None of the new names is a field of EngineResult, AppError or CliErrorOutput. The names
 *   an outcome has beside its result are exactly the listed ones.
 * - On a run with a denied command and a write: the CLI's `--json` line (as main.ts writes it) and
 *   result.json hold none of the names at any depth. The app's outcome holds no name but its listed
 *   ones, and its result is result.json's. Both runs stay true when the app fills the fields (the
 *   migration's next step) and fail if one is spread into the result.
 * Fake values only; a scripted model; no network and no real API.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";

import { RESULT_FILE_NAME } from "../../../src/contracts/index.js";
import type { CliErrorOutput, EngineResult, RunSummaryContext } from "../../../src/contracts/index.js";
import type { AppError, RunHandle, RunOutcome, RunTally, StartOutcome } from "../../../src/contracts/app.js";
import { createCodarynApp } from "../../../src/app/index.js";
import { stdoutText } from "../../../src/cli/guard.js";
import { runCli } from "../../../src/cli/run.js";
import { FAKE_SECRET, SECRET_ENV, WRITE_NOTES, appEnvironment, readJournal, runDir, setupRun, taskRequest } from "../app/support.js";
import { cliIo } from "../cli/k-support.js";

type Never<T> = [T] extends [never] ? true : false;
type OkOutcome = Extract<RunOutcome, { ok: true }>;
type RefusedStart = Extract<StartOutcome, { ok: false }>;

/** Every name an ok outcome has beside `ok` and `result`. */
const BESIDE_RESULT = ["lockLeft", "tally", "modelNotFound"] as const;
/** The handle's names new in C-6a; `configLanguage` is a refused start's too. */
const HANDLE_FACTS = ["configLanguage", "defaultConfig", "mask"] as const;
/** RunTally's fields, so that none of its counts is spread into the result either. */
const TALLY_FIELDS = [
  "deniedToolCalls",
  "deniedCommandCalls",
  "failedToolCalls",
  "deniedNotWritable",
  "deniedNotPlanned",
  "deniedUnreadable",
  "confirmationDenied",
  "policyNarrowings",
  "hiddenGroups",
] as const;
type NewName = (typeof BESIDE_RESULT)[number] | (typeof HANDLE_FACTS)[number] | keyof RunTally;
type Denied = NonNullable<RunTally["confirmationDenied"]>;
type SummaryDenied = Omit<NonNullable<RunSummaryContext["confirmationDenied"]>, "couldAsk">;

// Each must be `true`, or this file does not compile.
const TYPE_FACTS: [
  // The lists are complete: the ok outcome's names, the handle's new ones, RunTally's fields.
  Never<Exclude<keyof OkOutcome, "ok" | "result" | (typeof BESIDE_RESULT)[number]>>,
  Never<Exclude<(typeof HANDLE_FACTS)[number], keyof RunHandle>>,
  Never<Exclude<keyof RunTally, (typeof TALLY_FIELDS)[number]> | Exclude<(typeof TALLY_FIELDS)[number], keyof RunTally>>,
  // RunTally's fields are RunSummaryContext's, of types it takes; confirmationDenied less its couldAsk.
  Never<Exclude<keyof RunTally, keyof RunSummaryContext>>,
  Omit<RunTally, "confirmationDenied"> extends Pick<RunSummaryContext, Exclude<keyof RunTally, "confirmationDenied">> ? true : false,
  [Denied] extends [SummaryDenied] ? ([SummaryDenied] extends [Denied] ? true : false) : false,
  // No new name is the result's, an error's or an error line's; a refusal's language sits beside its error.
  Never<Extract<NewName, keyof EngineResult>>,
  Never<Extract<"configLanguage", keyof AppError | keyof CliErrorOutput>>,
  "configLanguage" extends keyof RefusedStart ? true : false,
] = [true, true, true, true, true, true, true, true, true];

const NEW_NAMES: readonly string[] = [...new Set<string>([...BESIDE_RESULT, ...HANDLE_FACTS, ...TALLY_FIELDS])];

/** The names among NEW_NAMES that `value` holds as a key, at any depth. */
function newNamesIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) newNamesIn(item, found);
  else if (typeof value === "object" && value !== null) {
    for (const [key, inner] of Object.entries(value)) {
      if (NEW_NAMES.includes(key)) found.add(key);
      newNamesIn(inner, found);
    }
  }
  return found;
}

/** A command the policy denies (no command rule), then a write and the end: counts to tally. */
const SCRIPT = [{ toolCalls: [{ name: "run_command", args: { executable: process.execPath, args: ["-e", "0"] } }] }, WRITE_NOTES, { text: "done" }];

describe("U-290: the app layer's new run fields stay beside the result", () => {
  test("by type: the lists are complete, RunTally keeps RunSummaryContext's meanings, and no new name is the result's or an error's", () => {
    assert.deepEqual(TYPE_FACTS, Array.from({ length: TYPE_FACTS.length }, () => true));
  });

  test("codaryn run --json: neither the JSON line nor result.json holds a new name", async () => {
    const base = await setupRun({}, {}, SCRIPT);
    const argv = ["run", "--task", path.join(base, "task.json"), "--json"];
    const outcome = await runCli(cliIo(base, { argv, env: { [SECRET_ENV]: FAKE_SECRET } }));
    const line = stdoutText(outcome, { argv, stdoutIsTerminal: false, stderrIsTerminal: false });
    const printed = JSON.parse(line) as EngineResult;
    assert.equal(printed.status, "done", line);
    const stored = JSON.parse(await readFile(path.join(runDir(base, printed.runId), RESULT_FILE_NAME), "utf8")) as EngineResult;
    assert.deepEqual(Object.keys(printed).sort(), Object.keys(stored).sort());
    assert.deepEqual([...newNamesIn(printed)], [], line);
    assert.deepEqual([...newNamesIn(stored)], []);
    // The run had something to count: the denied command is in the records, not in the line.
    const denied = (await readJournal(base, printed.runId)).filter((record) => record.type === "tool_decision" && !record.allowed);
    assert.equal(denied.length, 1, line);
  });

  test("the app's startRun: the outcome holds only its listed names beside the result, and the result is result.json's", async () => {
    const base = await setupRun({}, {}, SCRIPT);
    const app = createCodarynApp(await appEnvironment(base));
    const started = await app.startRun(taskRequest(base));
    assert.equal(started.ok, true, JSON.stringify(started));
    const handle = (started as { handle: RunHandle }).handle;
    const outcome = await handle.done;
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    const allowed: readonly string[] = ["ok", "result", ...BESIDE_RESULT];
    assert.deepEqual(
      Object.keys(outcome).filter((name) => !allowed.includes(name)),
      [],
    );
    const result = (outcome as OkOutcome).result;
    assert.deepEqual([...newNamesIn(result)], []);
    const stored = JSON.parse(await readFile(path.join(runDir(base, handle.runId), RESULT_FILE_NAME), "utf8")) as unknown;
    assert.deepEqual(JSON.parse(JSON.stringify(result)), stored);
  });
});
