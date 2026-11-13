/**
 * DR-7, DR-14: `codaryn changes`, the run's changes masked again for people and adapters.
 *
 *   codaryn changes (--task <task.json> | --workspace <dir> [--profile <name>])
 *                   [--config <config.json>] [--vars-file <path>] --run <runId|latest> [--json]
 *
 * It takes the task form `plan`, `apply` and `review` take (DR-17): those settings decide the
 * secrets the text is masked with (the ones a run with them registers now) and the workspace. The
 * work is the app layer's `changes`; this file parses, calls and prints.
 * - `--json`: ChangesOutput as one JSON line (what the VS Code extension reads, VX-D14).
 * - otherwise: per file its path and state, then the changed region as `-`/`+` lines when the
 *   text is shown. DR-29: a file's text is shown only when the secrets registered now mask it as
 *   the run did, by the run's record; otherwise (`masking_unverified`) its path and state only, and
 *   the text says why once instead of per file.
 * - U-36 (UXM-7 ③): the words of the text form come from the message catalog when one is given
 *   (ChangesEnvironment.messages: the contract's `changes.*` ids); without one, the English below.
 *   That English is the text before U-36 line for line, with one line more: a run with a
 *   records-changed mark (ChangesOutput.recordsChanged, U-43) says so after the heading, with or
 *   without a catalog (`changes.records_changed`, which the PM accepted). The English catalog (main.ts
 *   gives it) has the same lines but those of `changes.apply_run`, `changes.unavailable.<reason>`
 *   and `changes.no_text_note` (without "(DR-29)", review R-66); the PM accepted those too. The JSON
 *   is not touched.
 * Reads only: nothing is created, changed or locked, and no request is made.
 *
 * The parser lives here until N-A moves it into args.ts; main.ts, help and the contract are N-A's
 * (DR-14).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { ANTHROPIC_API_KEY_ENV, LATEST_RUN_ALIAS, RUNS_MAX_LIMIT, planApplyStateOf } from "../contracts/index.js";
import type { MessageCatalog, RunId, RunListEntry } from "../contracts/index.js";
import { toCliError } from "../app/index.js";
import type { ChangedFileView, ChangesOutput, CodarynApp, TaskForm } from "../app/index.js";
import { ENV_FILE_REFUSED_MESSAGE, RUN_ID_PATTERN } from "./args.js";
import type { ArgsFailure } from "./args.js";
import { jsonLine } from "./guard.js";
import type { CommandOutcome } from "./guard.js";
import { argumentsError, cliError } from "./run.js";
import { knownKeyValues } from "./settings.js";
import type { SettingsEnvironment } from "./settings.js";
import { inputFileTooLarge } from "./security/index.js";
import { cleanText, hideKeys, hideKeysInStrings } from "./text-safety.js";

export const CHANGES_USAGE =
  "codaryn changes (--task <task.json> | --workspace <dir> [--profile <name>]) " +
  "[--config <config.json>] [--vars-file <path>] --run <runId|latest> [--json]";

export interface ChangesArgs {
  readonly command: "changes";
  readonly settings: TaskForm;
  readonly runId: string;
  readonly json: boolean;
}

export type ParseChangesArgsOutcome = { readonly ok: true; readonly args: ChangesArgs } | ArgsFailure;

const OPTIONS = ["--task", "--workspace", "--profile", "--config", "--vars-file", "--run"] as const;
type Option = (typeof OPTIONS)[number];
/** Same names args.ts refuses in every command (T-15, V-3). */
const NODE_ENV_FILE_FLAG = /^--env-file(-if-exists)?(=|$)/;

/** Each option at most once with a value that is not empty and does not start with "--". */
export function parseChangesArgs(argv: readonly string[]): ParseChangesArgsOutcome {
  const [command, ...rest] = argv;
  if (command !== "changes") return { ok: false, message: CHANGES_USAGE, hint: "unknown_command" };
  if (rest.some((item) => NODE_ENV_FILE_FLAG.test(item))) return { ok: false, message: ENV_FILE_REFUSED_MESSAGE };
  const values = new Map<Option, string>();
  let json = false;
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index] as string;
    if (flag === "--json") {
      // U-37: told by its place after the command word, never its name.
      if (json) return { ok: false, message: `unknown or repeated option. ${CHANGES_USAGE}`, hint: "unknown_option", position: index + 1 };
      json = true;
      continue;
    }
    if (!(OPTIONS as readonly string[]).includes(flag) || values.has(flag as Option)) {
      return { ok: false, message: `unknown or repeated option. ${CHANGES_USAGE}`, hint: "unknown_option", position: index + 1 };
    }
    const value = rest[index + 1];
    if (value === undefined || value.length === 0 || value.startsWith("--")) {
      return { ok: false, message: `${flag} needs a value. ${CHANGES_USAGE}` };
    }
    values.set(flag as Option, value);
    index += 1;
  }

  const taskPath = values.get("--task");
  // U-17 (UXM-19, DR-46): a reading command takes the current directory when neither is given.
  const workspace = values.get("--workspace") ?? (taskPath === undefined ? "." : undefined);
  const profile = values.get("--profile") ?? null;
  if ((taskPath === undefined) === (workspace === undefined)) {
    return { ok: false, message: `give either --task or --workspace. ${CHANGES_USAGE}` };
  }
  if (taskPath !== undefined && profile !== null) {
    return { ok: false, message: `--profile goes with --workspace; a task file has its own settings. ${CHANGES_USAGE}` };
  }
  const runId = values.get("--run");
  if (runId === undefined) return { ok: false, message: `--run is required. ${CHANGES_USAGE}` };
  if (runId !== LATEST_RUN_ALIAS && (!RUN_ID_PATTERN.test(runId) || runId.includes(".."))) {
    return { ok: false, message: "--run must be a run id: 1-128 characters of letters, digits, '.', '_' and '-', or latest", hint: "run_id_form" };
  }
  return {
    ok: true,
    args: {
      command: "changes",
      settings: {
        input: taskPath !== undefined ? { kind: "task", taskPath } : { kind: "workspace", workspace: workspace as string },
        configPath: values.get("--config") ?? null,
        varsFile: values.get("--vars-file") ?? null,
        profile,
        // The workflow decides no secret, so `changes` takes no --workflow.
        workflowRef: null,
      },
      runId,
      json,
    },
  };
}

/** Lines shown per file and side before the rest is summarised. */
export const MAX_SHOWN_LINES = 200;

type FileState = ChangedFileView["state"];
type Unavailable = NonNullable<ChangedFileView["unavailable"]>;

/** U-36: the words of the text form, one per catalog id (src/contracts/human.ts, `changes.*`). */
interface ChangesWords {
  heading(runId: RunId): string;
  noTextNote(): string;
  recordsChanged(): string;
  none(): string;
  applyRun(count: number, planRunId: RunId): string;
  planOnly(): string;
  planApplied(applyRunId: RunId): string;
  planApplyOther(applyRunId: RunId): string;
  file(created: boolean): string;
  state(state: FileState): string;
  /** Why the text is not shown; the renderer adds the code in parentheses. */
  unavailable(reason: Unavailable): string;
  noDifference(): string;
  moreLines(count: number): string;
}

const STATE_TEXT: { readonly [S in FileState]: string } = {
  as_run_left: "as the run left it",
  changed_since_run: "changed again since the run",
  missing: "no longer exists",
  unknown: "could not be read now",
};

/**
 * The fallback without a catalog: the text before U-36 character for character, and
 * `recordsChanged`, the one line U-36 adds (a run with a records-changed mark, U-43).
 */
const ENGLISH_WORDS: ChangesWords = {
  heading: (runId) => `changes of run ${runId}, masked with the secrets registered now (not the run's own masking)`,
  noTextNote: () =>
    "no text for some files: a file's text is shown only when the secrets registered now mask it as the run did and the file is as the run left it; the others have their path and state only (DR-29)",
  recordsChanged: () => "This run has a records-changed mark, so no file text is shown; only paths and states.",
  none: () => "the run changed no file",
  planOnly: () => "This run only made a plan and changed no file itself.",
  planApplied: (applyRunId) => `Its plan was applied by run ${cleanText(applyRunId)}; that run's report lists the moves.`,
  planApplyOther: (applyRunId) => `An apply run took up its plan: ${cleanText(applyRunId)}; codaryn runs shows where that apply stands.`,
  applyRun: (count, planRunId) => `the run is an apply run: it applied ${count} action(s) of the plan of run ${cleanText(planRunId)} (moves and discards, not file writes); codaryn report lists them`,
  file: (created) => (created ? "created by the run" : "changed by the run"),
  state: (state) => STATE_TEXT[state],
  unavailable: () => "the text is not shown",
  noDifference: () => "no difference to the original",
  moreLines: (count) => `... ${count} more lines`,
};

/**
 * U-36: the catalog's words; a text the catalog cannot give (an id or parameter it refuses) is the
 * English one, as the plan view does (planViewText), so the command still prints.
 */
function catalogWords(messages: MessageCatalog): ChangesWords {
  const or = (text: () => string, english: () => string): string => {
    try {
      return text();
    } catch {
      return english();
    }
  };
  return {
    heading: (runId) => or(() => messages.format("changes.heading", { runId }), () => ENGLISH_WORDS.heading(runId)),
    noTextNote: () => or(() => messages.format("changes.no_text_note"), ENGLISH_WORDS.noTextNote),
    recordsChanged: () => or(() => messages.format("changes.records_changed"), ENGLISH_WORDS.recordsChanged),
    none: () => or(() => messages.format("changes.none"), ENGLISH_WORDS.none),
    planOnly: () => or(() => messages.format("changes.plan_only"), ENGLISH_WORDS.planOnly),
    planApplied: (applyRunId) => or(() => messages.format("changes.plan_applied", { runId: applyRunId }), () => ENGLISH_WORDS.planApplied(applyRunId)),
    planApplyOther: (applyRunId) => or(() => messages.format("changes.plan_apply_other", { runId: applyRunId }), () => ENGLISH_WORDS.planApplyOther(applyRunId)),
    applyRun: (count, planRunId) => or(() => messages.format("changes.apply_run", { count, runId: planRunId }), () => ENGLISH_WORDS.applyRun(count, planRunId)),
    file: (created) => or(() => messages.format(created ? "changes.file.created" : "changes.file.changed"), () => ENGLISH_WORDS.file(created)),
    state: (state) => or(() => messages.format(`changes.state.${state}`), () => ENGLISH_WORDS.state(state)),
    unavailable: (reason) => or(() => messages.format(`changes.unavailable.${reason}`), () => ENGLISH_WORDS.unavailable(reason)),
    noDifference: () => or(() => messages.format("changes.no_difference"), ENGLISH_WORDS.noDifference),
    moreLines: (count) => or(() => messages.format("changes.more_lines", { count }), () => ENGLISH_WORDS.moreLines(count)),
  };
}

const wordsOf = (messages: MessageCatalog | undefined): ChangesWords => (messages === undefined ? ENGLISH_WORDS : catalogWords(messages));

/** Lines without their LF or CRLF ending (a change of line ending alone is not shown). */
function lines(text: string): string[] {
  const all = text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  if (all.length > 0 && all.at(-1) === "") all.pop();
  return all;
}

function shown(prefix: string, items: readonly string[], words: ChangesWords): string[] {
  const out = items.slice(0, MAX_SHOWN_LINES).map((line) => `${prefix} ${line}`);
  if (items.length > MAX_SHOWN_LINES) out.push(`${prefix} ${words.moreLines(items.length - MAX_SHOWN_LINES)}`);
  return out;
}

/**
 * The changed region of two texts: the lines between their common first and last lines, as one
 * `@@ -start,count +start,count @@` block. Empty when they are the same. `messages` (U-36) words
 * the "more lines" line of a cut side; English without it.
 */
export function changedRegion(before: string | null, after: string | null, messages?: MessageCatalog): string[] {
  const words = wordsOf(messages);
  const old = before === null ? [] : lines(before);
  const now = after === null ? [] : lines(after);
  let head = 0;
  while (head < old.length && head < now.length && old[head] === now[head]) head += 1;
  let tail = 0;
  while (tail < old.length - head && tail < now.length - head && old[old.length - 1 - tail] === now[now.length - 1 - tail]) tail += 1;
  const removed = old.slice(head, old.length - tail);
  const added = now.slice(head, now.length - tail);
  if (removed.length === 0 && added.length === 0) return [];
  return [`@@ -${head + 1},${removed.length} +${head + 1},${added.length} @@`, ...shown("-", removed, words), ...shown("+", added, words)];
}

/**
 * The text form. Every piece comes from the masked output; control characters are replaced. U-36:
 * the words are `messages`' (the person's language); the English before U-36 without it.
 */
/**
 * U-131 (N4): a plan run (plan_pending) and what became of its plan, by the run list's rule
 * (planApplyStateOf): null when no apply took it up. For the text only; the JSON does not carry it.
 */
export interface ChangesPlanRun {
  readonly apply: ReturnType<typeof planApplyStateOf>;
}

export function renderChanges(output: ChangesOutput, messages?: MessageCatalog, planRun?: ChangesPlanRun | null): string {
  const words = wordsOf(messages);
  // The app layer gives only run ids that pass RUN_ID_PATTERN.
  const out = [words.heading(output.runId as RunId)];
  // U-43 (DR-38): a run with a records-changed mark has no file text; say why first.
  if (output.recordsChanged === true) out.push(words.recordsChanged());
  // DR-29: a file's text is shown only when the secrets registered now mask it as the run did, by
  // the run's record. Why is said once; which files have no text is said per file, since one result
  // can hold both (the app layer's finding).
  if (output.files.some((file) => file.unavailable === "masking_unverified")) out.push(words.noTextNote());
  // U-16 (UXM-4): an apply run's changes are its plan's actions, not file writes of its own; the
  // app layer gives them as `applyRun` (contract ChangesApplyRun).
  const applyRun = output.applyRun;
  if (applyRun !== undefined) out.push(words.applyRun(applyRun.actions, applyRun.planRunId));
  else if (output.files.length === 0 && planRun !== undefined && planRun !== null) {
    // U-131 (N4, UXM-4, 5): a plan run changes no file itself; its plan's apply run is the one that does.
    out.push(words.planOnly());
    const apply = planRun.apply;
    if (apply !== null) out.push(apply.state === "applied" ? words.planApplied(apply.applyRunId) : words.planApplyOther(apply.applyRunId));
  } else if (output.files.length === 0) out.push(words.none());
  for (const file of output.files) {
    out.push(`== ${cleanText(file.path)}: ${words.file(file.created)}; ${words.state(file.state)}`);
    if (file.unavailable !== null) {
      out.push(`   ${words.unavailable(file.unavailable)} (${file.unavailable})`);
      continue;
    }
    const region = changedRegion(file.created ? null : file.before, file.after, messages);
    if (region.length === 0) out.push(`   ${words.noDifference()}`);
    for (const line of region) out.push(cleanText(line));
  }
  return `${out.join("\n")}\n`;
}

export interface ChangesEnvironment {
  readonly argv: readonly string[];
  /** Read only to keep the current key out of what is printed. */
  readonly env: SettingsEnvironment;
  /**
   * The app layer (`createCodarynApp` with the process's environment in main.ts). U-131 (N4): its
   * `listRuns`, when given, tells the text whether the run is a plan run and what became of its plan.
   */
  readonly app: Pick<CodarynApp, "changes"> & Partial<Pick<CodarynApp, "listRuns">>;
  /** U-131 (N4): where a task file's relative path is resolved (the process's cwd in main.ts). */
  readonly cwd?: string;
  /** U-131 (N4): reads a task file for its workspaceRoot (best effort, text only). */
  readonly readFile?: (file: string) => Promise<string>;
  /** U-36: the person's message catalog for the text form (main.ts's); English without it. The JSON does not use it. */
  readonly messages?: MessageCatalog;
}

/**
 * U-131 (N4): whether the run is a plan run and what became of its plan, from the run list of its
 * workspace (the --workspace given, or the task file's workspaceRoot). Best effort, for the text: a
 * list or file that cannot be read leaves the text as before (null).
 */
async function planRunOf(io: ChangesEnvironment, settings: TaskForm, runId: string): Promise<ChangesPlanRun | null> {
  const listRuns = io.app.listRuns;
  if (listRuns === undefined) return null;
  try {
    const cwd = io.cwd ?? process.cwd();
    let workspace: string;
    if (settings.input.kind === "workspace") {
      workspace = path.resolve(cwd, settings.input.workspace);
    } else {
      const taskPath = path.resolve(cwd, settings.input.taskPath);
      const taskText = (await (io.readFile ?? ((file: string) => readFile(file, "utf8")))(taskPath)).replace(/^\uFEFF/, "");
      // U-153 (R-94 I4): the first read's size check (DR-40 (b)); a larger file gives the text as before.
      if (inputFileTooLarge(taskText)) return null;
      const task = JSON.parse(taskText) as { workspaceRoot?: unknown };
      if (typeof task.workspaceRoot !== "string") return null;
      workspace = path.resolve(path.dirname(taskPath), task.workspaceRoot);
    }
    const listed = await listRuns.call(io.app, { workspace, limit: RUNS_MAX_LIMIT });
    if (!listed.ok) return null;
    const entries: readonly RunListEntry[] = listed.output.runs;
    const entry = entries.find((other): other is Extract<RunListEntry, { readonly state: "checked" }> => other.state === "checked" && other.runId === runId);
    if (entry === undefined || entry.reason !== "plan_pending") return null;
    return { apply: planApplyStateOf(entry, entries) };
  } catch {
    return null;
  }
}

/** `codaryn changes`. Text on stdout, or ChangesOutput as one JSON line with `--json`. Errors are CliErrorOutput. */
export async function runChanges(io: ChangesEnvironment): Promise<CommandOutcome> {
  const parsed = parseChangesArgs(io.argv);
  if (!parsed.ok) return argumentsError(parsed);
  const outcome = await io.app.changes({ settings: parsed.args.settings, runId: parsed.args.runId });
  if (!outcome.ok) {
    const output = toCliError(outcome.error);
    return { output, exitCode: output.exitCode };
  }
  const currentKey = knownKeyValues(io.env);
  // N-19: one ASCII JSON line. N-27 (c): keys are hidden in the strings before the JSON is written
  // (in JSON text a control character becomes a six-character escape the key check cannot see through).
  const planRun = parsed.args.json || outcome.output.files.length > 0 || outcome.output.applyRun !== undefined ? null : await planRunOf(io, parsed.args.settings, outcome.output.runId);
  const text = parsed.args.json ? jsonLine(hideKeysInStrings(outcome.output, currentKey)) : hideKeys(renderChanges(outcome.output, io.messages, planRun), currentKey);
  return { text, exitCode: outcome.output.exitCode };
}
