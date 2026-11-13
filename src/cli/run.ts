/**
 * `codaryn run`: reads the settings and the task, prepares the model, then hands over to the
 * assembled engine. Every outcome becomes one CliOutput object and its exit code.
 * Messages never contain secret values, keys or file contents.
 *
 * Order (security checks S-1 to S-9 from `./security`):
 *  1. arguments; every path given on the command line must be a local path (S-5)
 *  2. `--vars-file` (T-15): read, reject a BOM, load; values it newly set become secrets (S-4)
 *  3. current key; the config file: `--config`, CODARYN_CONFIG (a local path, S-5) or the default
 *     location (N-1); `--goal` or the one-line goal (N-9) must not hold a key (S-8)
 *  4. config and task files: read, key check on the raw text, parse, key check on the parsed
 *     value with a depth limit (S-6). A key stops the run before anything else is checked
 *  5. validate the config (S-3, S-7, S-9), apply `--profile` (N-8), then the task (S-3, S-5, S-7)
 *  6. the workspace exists and is apart from the CLI's install directory (U-3); the env, config,
 *     task, script and cancel files are outside it (S-1); `integrity.paths` exist outside it (U-1)
 *  7. secret values: secretEnv (S-3 messages), the key in every run (S-2), env file values (S-4)
 *  8. model, then the assembled engine
 * Steps 1 to 7 are prepareTask's, in src/app/prepare.ts since the CLI migration's C-5 (U-287). Since
 * C-6a (U-296) steps 8 on are the app layer's run life (runLife, src/app/run-life.ts); this file draws
 * what a person sees (runThroughApp). Since C-6b (U-300) a run that carries out an approved plan
 * (codaryn apply) goes through the same life; this file holds no run life of its own.
 */

import { toShownWorkspace } from "../contracts/index.js";
import type {
  JournalEvent,
  MaskedText,
  MessageLanguage,
  PrivacyGateway,
  HumanOutput,
  MessageCatalog,
  RunSummaryContext,
} from "../contracts/index.js";
import { cleanText } from "../app/input/text-safety.js";
import { createMessageCatalog } from "../i18n/index.js";
import { terminalConfirm } from "./confirm.js";
import type { AskLine } from "./confirm.js";
import { parseArgs } from "./args.js";
import type { Assemble } from "../app/assembly.js";
import { PROGRESS_PREFIX, englishProgressLines, writeProgressLines } from "./progress.js";
import { journalWithEvents } from "../app/events.js";
import { MODEL_NOT_FOUND_HINT, defaultConfigNotice, runLife } from "../app/run-life.js";
import type { ApprovedRunPlan, RunLifeEnvironment } from "../app/run-life.js";
import type { RunObserver } from "../app/types.js";
import { argumentsError, cliError as error, prepareTask } from "../app/prepare.js";
import type { CliRunOutcome, PrepareEnvironment, PreparedTask, RunArgs, RunNotes } from "../app/prepare.js";

// U-287 (CLI migration C-5): the run's steps 1 to 7 (prepareTask) and the error outcomes are the app
// layer's now (src/app/prepare.ts). These re-exports keep the old names for the tests, the CLI's
// commands until they import from there, and the app layer (plan A).
export { argumentsError, cliError, jsonSyntaxError, positionDiagnostic, prepareTask, settingsError, withHint, workflowProblemText } from "../app/prepare.js";
export type { CliRunOutcome, PrepareEnvironment, PreparedTask, RunNotes, RunOutcomeInfo } from "../app/prepare.js";
// U-293 (C-6a): the end summary's counting is the app layer's (src/app/tally.ts); its test keeps this name.
export { notePrivateData } from "../app/tally.js";
// U-296 (C-6a): the Y-4 hint and the default location's notice are the app layer's run life's (one text
// each); tests take them by these names.
export { MODEL_NOT_FOUND_HINT, defaultConfigNotice } from "../app/run-life.js";
// U-300 (C-6b): the approved run plan a run carries out is the run life's type (U-303); plan-commands
// and the tests take it by this name.
export type { ApprovedRunPlan } from "../app/run-life.js";

/**
 * `codaryn run`'s environment. U-300 (C-6b; ne-verify R-115 I-2): it widens the app layer's
 * RunLifeEnvironment (src/app/run-life.ts), which holds what the run's life reads, so a field taken
 * from there leaves this type without it, and the CLI's code and the tests that give it fail to
 * compile. In the CLI's own process (main.ts) `assemble` is assembleRun (the run's commands get
 * process.env, DR-4) and `cancelSignal` hooks SIGINT and SIGTERM with process.on and watches the
 * cancel file; `runTask`, `runApprovedPlan` and the provider fields are tests' overrides (the
 * engines; the anthropic factory and the `fetch` it is given; SP-6's factories and injection
 * points, anthropic falling back to `anthropicDeps`). Only what the CLI reads itself is declared here.
 */
export interface CliEnvironment extends PrepareEnvironment, RunLifeEnvironment {
  readonly argv: readonly string[];
  /**
   * U-110 (B-5): asks one line at a terminal. The real CLI gives it only when standard input and
   * stderr are terminals. Absent, or with --quiet: the permission question is not asked (denied by
   * default, DR-10).
   */
  readonly ask?: AskLine;
  /** U-8: writes one progress line (with its line feed) to stderr. Absent or `--quiet`: no progress. */
  readonly writeProgress?: (line: string) => void;
  /**
   * N-4, N-5: the human renderer and the catalog for the config file's language (null when it has
   * none). Called once the config is read. Absent: English progress lines and no end summary.
   */
  readonly human?: (configLanguage: MessageLanguage | null) => { readonly output: HumanOutput; readonly messages: MessageCatalog };
}

/** U-182: the English of progress.not_writable_hint, when no catalog is given. */
const notWritableHint = (count: number): string =>
  `Writes denied because the file is not in writablePaths: ${count}. To allow a file, add it to writablePaths wherever that is set (config file, profile, task type, task file); every list must cover it.`;

/** Writes one masked progress line; best effort. */
function writeMasked(write: (line: string) => void, privacy: PrivacyGateway, text: string): void {
  const masked = privacy.mask(`${PROGRESS_PREFIX}${text}`);
  if (!masked.ok) return;
  try {
    write(`${masked.text}\n`);
  } catch {
    // Progress is best effort.
  }
}

export async function runCli(io: CliEnvironment): Promise<CliRunOutcome> {
  const parsed = parseArgs(io.argv);
  if (!parsed.ok) return argumentsError(parsed);
  const args = parsed.args;
  const notes: RunNotes = { configLanguage: null, configDefault: null, deniedToolCalls: 0, deniedCommandCalls: 0, failedToolCalls: 0 };
  const outcome = await runParsed(io, args, notes);
  return { ...outcome, info: { configLanguage: notes.configLanguage, summary: summaryContext(args, notes), quiet: args.quiet } };
}

/** N-5, N-17, N-23: what the end summary needs; no typed or file value. */
function summaryContext(args: RunArgs, notes: RunNotes): RunSummaryContext {
  return {
    workspaceForm: args.input.kind === "task" ? "task" : args.input.oneLine ? "current" : "given",
    // DR-51 (U-38): with "given" only; the hints then show the path the person typed.
    ...(args.input.kind === "quick" && !args.input.oneLine && notes.workspaceShown !== undefined ? { workspaceShown: notes.workspaceShown } : {}),
    configDefault: notes.configDefault,
    profileApplied: args.profile !== null,
    deniedToolCalls: notes.deniedToolCalls,
    deniedCommandCalls: notes.deniedCommandCalls,
    failedToolCalls: notes.failedToolCalls,
    // U-110 (R-85 M1): the denials after a permission question, so the hint is not to add a rule.
    ...(notes.confirmationDenied === undefined ? {} : { confirmationDenied: { ...notes.confirmationDenied, couldAsk: notes.couldAsk === true } }),
    // U-148 (U-140, UXM-18): what the task type left out, as run_started records it; not when empty.
    ...(notes.policyNarrowings === undefined || notes.policyNarrowings.length === 0 ? {} : { policyNarrowings: notes.policyNarrowings }),
    // U-195 (Codex V-14 L-1, U-198): the writes refused as not writable, by why; not when none.
    ...(notes.deniedNotPlanned === undefined ? {} : { deniedNotPlanned: notes.deniedNotPlanned }),
    ...(notes.deniedNotWritable === undefined ? {} : { deniedNotWritable: notes.deniedNotWritable }),
    // U-210 (U-207): the calls refused at unreadable paths and the table results that hid groups; not when none.
    ...(notes.deniedUnreadable === undefined ? {} : { deniedUnreadable: notes.deniedUnreadable }),
    ...(notes.hiddenGroups === undefined ? {} : { hiddenGroups: { ...notes.hiddenGroups } }),
    // U-220 (U-201): the run's lock could not be released at its end; not when it was.
    ...(notes.lockLeft === true ? { lockLeft: true } : {}),
    policySource: args.input.kind === "task" ? "task" : "config",
  };
}

/** Writes human text (several lines) masked with the run's gateway and cleaned; best effort. */
function writeHuman(write: (line: string) => void, privacy: PrivacyGateway, text: string): void {
  if (text.length === 0) return;
  const masked = privacy.mask(text);
  if (!masked.ok) return;
  try {
    write(`${cleanText(masked.text, true).replace(/\t/g, " ").replace(/\n?$/, "\n")}`);
  } catch {
    // Human output is best effort.
  }
}

async function runParsed(io: CliEnvironment, args: RunArgs, notes: RunNotes): Promise<CliRunOutcome> {
  const ready = await prepareTask(io, args, notes);
  if (!("prepared" in ready)) return ready;
  return runPrepared(io, args, notes, ready.prepared);
}

/**
 * U-296 (the CLI migration's C-6a, its fourth commit): a run's steps 8 on are the app layer's run life
 * (runLife: the model, the HTTP 404 watch, the cancel source, the assembly and the lock, the end
 * summary's counts, the engine, the notices, the end); since C-6b (U-300) also those of a run that
 * carries out an approved run plan (`approved`: the plan's claim, the records-changed mark looked at
 * again under the lock and the writes refused outside the plan are the life's, R-115 I-1), on this
 * run's own environment as
 * it is (process.env with the variables file loaded into it, the CLI's assembly: DR-4 as before), so
 * what a test gives reaches the life unchanged. The CLI draws what a person sees, as before:
 * - once assembled: the typed workspace for the end summary (DR-51), the renderer in the config's
 *   language, the permission question at a terminal (B-5), and each record as stored
 *   (RunObserver.onStoredRecord, through the app's journalWithEvents) drawn as its progress lines and
 *   masked with the run's gateway as RunHandle.mask masks; right after the start, the default
 *   location's line (N-1);
 * - after the run, the lock released: the Y-4 line, the writablePaths line and the end summary.
 * The refusals are the life's own (cliError), so the JSON line keeps its keys' order.
 */
async function runThroughApp(io: CliEnvironment, args: RunArgs, notes: RunNotes, prepared: PreparedTask, approved?: ApprovedRunPlan): Promise<CliRunOutcome> {
  const { defaultDisplay } = prepared;
  // U-8: progress lines follow the journal; they start only once the run has started.
  const write = args.quiet ? undefined : io.writeProgress;
  // Set once assembled (the closure below), so declared wide: control flow cannot see that.
  let privacy = null as PrivacyGateway | null;
  // N-4, N-5: the human renderer in the chosen language (the config's language is known now).
  let human = undefined as { readonly output: HumanOutput; readonly messages: MessageCatalog } | undefined;
  const assemble: Assemble = async (input) => {
    const assembled = await io.assemble(input);
    if (!assembled.ok) return assembled;
    const gateway = assembled.deps.privacy;
    privacy = gateway;
    // DR-51 (U-38): the typed --workspace for the end summary's hints, after the run's own masking.
    // Best effort, as the summary is: a gateway that cannot mask it leaves the hint at <workspace>.
    if (args.input.kind === "quick" && !args.input.oneLine) {
      try {
        const typed = args.input.workspace;
        const masked = gateway.mask(typed);
        const shown = toShownWorkspace(typed, masked.ok ? masked.text : null);
        if (shown !== null) notes.workspaceShown = shown;
      } catch {
        // No path is shown.
      }
    }
    try {
      human = write === undefined ? undefined : io.human?.(notes.configLanguage);
    } catch {
      human = undefined;
    }
    const shown = human;
    // As RunHandle.mask masks (app.ts): with the run's gateway; null when the text cannot be masked.
    const mask = (text: string): MaskedText | null => {
      try {
        const masked = gateway.mask(text);
        return masked.ok ? masked.text : null;
      } catch {
        return null;
      }
    };
    const render = shown === undefined ? englishProgressLines() : (event: JournalEvent) => shown.output.progressLine(event);
    let announced = defaultDisplay === null;
    const observer: RunObserver =
      write === undefined
        ? {}
        : {
            onStoredRecord(record) {
              writeProgressLines(record, mask, write, render);
              // N-1: say once, right after the run started, that the default config location was used.
              if (!announced && record.type === "run_started") {
                announced = true;
                writeMasked(
                  write,
                  gateway,
                  shown !== undefined && defaultDisplay !== null
                    ? shown.messages.format("progress.config_default", { location: defaultDisplay })
                    : defaultConfigNotice(defaultDisplay ?? ""),
                );
              }
            },
          };
    // U-110 (B-5): at a terminal and without --quiet, the engine's permission question is asked on
    // stderr in the chosen language (English when no renderer is given).
    let questions: MessageCatalog | undefined;
    if (!args.quiet && io.ask !== undefined) {
      try {
        questions = shown?.messages ?? io.human?.(notes.configLanguage).messages;
      } catch {
        questions = undefined;
      }
    }
    const confirm = args.quiet || io.ask === undefined ? undefined : terminalConfirm(io.ask, questions ?? createMessageCatalog("en"));
    notes.couldAsk = confirm !== undefined;
    const journal = journalWithEvents(assembled.deps.journal, observer, gateway);
    return { ...assembled, deps: { ...assembled.deps, journal, ...(confirm === undefined ? {} : { confirm }) } };
  };
  const end = await runLife({ ...io, assemble }, args, notes, prepared, approved);
  if (end.kind === "refused") return { output: end.output, exitCode: end.output.exitCode };
  const result = end.result;
  try {
    if (write !== undefined && privacy !== null) {
      const gateway: PrivacyGateway = privacy;
      const shown = human;
      // Y-4: the line in the chosen language when the life added the hint; the notice stays English.
      if (end.modelNotFound) writeMasked(write, gateway, shown === undefined ? MODEL_NOT_FOUND_HINT : shown.messages.format("progress.model_not_found"));
      // U-182 (DR-69 B-4): writes denied as path_not_writable, and how to allow a file. A progress
      // line only; the result is unchanged. U-195 (Codex V-14 L-1, U-198): not in a run that carries
      // out a plan, whose refused writes are counted as outside the plan (deniedNotPlanned), which no
      // writablePaths entry widens; the end summary tells those and how to go on.
      const notWritable = notes.deniedNotWritable ?? 0;
      if (notWritable > 0) {
        writeMasked(write, gateway, shown === undefined ? notWritableHint(notWritable) : shown.messages.format("progress.not_writable_hint", { count: notWritable }));
      }
      // N-5: the end summary on stderr, after the lock is released.
      if (shown !== undefined) {
        let summary = "";
        try {
          summary = shown.output.runSummary(result, summaryContext(args, notes));
        } catch {
          summary = "";
        }
        writeHuman(write, gateway, summary);
      }
    }
  } catch {
    // As before, when a line after the engine could not be drawn (the life has released the lock).
    return error("internal_error", "the run stopped because of an internal error");
  }
  return { output: result, exitCode: result.exitCode };
}

/**
 * Steps 8 on (the model, the assembly, the engine, the end summary) for a prepared task, through the
 * app layer's run life (runThroughApp). `run` gives no `approved`. U-195: `codaryn apply` gives the
 * approved `run` plan it checked: the assembly then claims that plan run (AssemblyInput.planRunId) and
 * the engine's runApprovedPlan carries it out (EngineResult with planRunId and planDigest); the rest
 * (progress lines, end summary, result.json) is a run's. Since C-6b (U-300) that run takes the same
 * life (U-303). The name stays for plan-commands, which the app layer's applyPlan reaches too (C-7b).
 */
export async function runPrepared(io: CliEnvironment, args: RunArgs, notes: RunNotes, prepared: PreparedTask, approved?: ApprovedRunPlan): Promise<CliRunOutcome> {
  return runThroughApp(io, args, notes, prepared, approved);
}
