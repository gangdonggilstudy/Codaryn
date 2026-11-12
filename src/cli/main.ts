#!/usr/bin/env node
/**
 * Process entry point (`bin.codaryn` in package.json). Writes exactly one output to stdout and
 * exits with its code: one JSON line for `run` and `revert` (and errors of every command), text
 * for `report`, `doctor`, `models`, `runs`, `init`, `--help` and `--version` (`--json` makes
 * report, doctor, models, runs and init print JSON). Every JSON line is ASCII (N-19).
 * DR-49 (U-23): at a terminal, without `--json` or `--quiet`, the JSON line is left out (the human
 * text on stderr says it); `codaryn` with no arguments shows the help (through a pipe or into a
 * file it stays invalid_arguments, as before).
 *
 * Human-readable output goes to stderr in the chosen language (N-4, N-5): an explained error for
 * every CliErrorOutput, the progress lines and end summary of `run`, the summary of `revert`, the
 * run `--run latest` chose (N-23), and the questions of `init`. `--quiet` anywhere in the
 * arguments turns all of it off, even when the arguments cannot be parsed.
 * `models` may ask for a number at a terminal (Y-3); the question goes to stdout.
 * Any exception becomes `internal_error` (exit code 70) without its text or stack (S-6).
 */

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { CODARYN_LANG_ENV } from "../contracts/index.js";
import type { CliErrorOutput, HumanOutput, MessageCatalog, MessageLanguage } from "../contracts/index.js";
import { createCodarynApp, createNodeAppEnvironment } from "../app/index.js";
import { createMessageCatalog, explainMessageLanguage, runtimeLocale, selectMessageLanguage } from "../i18n/index.js";
import { inspectRun, listRuns, loadPlan, readRevertRecord, revertRun, writeRevertRecord } from "../store/index.js";
import { assembleRun, createRevertCommand } from "./assemble.js";
import { createCancelSource } from "./cancel.js";
import { runChanges } from "./changes.js";
import { runCleanup } from "./cleanup.js";
import { defaultLocationRefused, findDefaultConfigLocation } from "./config-file.js";
import { runDoctor } from "./doctor.js";
import { runGuardedCommand, stdoutText } from "./guard.js";
import type { CommandOutcome } from "./guard.js";
import { helpRequest, helpText, versionText } from "./help.js";
import { createHumanOutput } from "./human/index.js";
import { runInit } from "./init.js";
import { findInstall } from "./install.js";
import type { InstallInfo } from "./install.js";
import { runModels } from "./models.js";
import { runApply, runPlan, runReview } from "./plan-commands.js";
import { API_MODEL_LISTERS, anthropicModelLister } from "./provider.js";
import { runReport } from "./report.js";
import { runRevert } from "./revert.js";
import { runCli } from "./run.js";
import { runRuns } from "./runs.js";
import { locateInWorkspace, relateRealPaths } from "./security/index.js";
import { envValue, knownKeyValues } from "./settings.js";
import { cleanText, hideKeys } from "./text-safety.js";
// N-D 4.4: the explained error with the lock hint (kept apart from the command imports above).
import { explainedErrorText } from "./error-text.js";

const argv = process.argv.slice(2);
/** N-5: `--quiet` anywhere turns the human-readable stderr output off, parsed or not. */
const quiet = argv.includes("--quiet");
const isDirectory = async (dir: string): Promise<boolean> => {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
};
const isFile = async (file: string): Promise<boolean> => {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
};
const exists = async (target: string): Promise<boolean> => {
  try {
    await lstat(target);
    return true;
  } catch {
    return false;
  }
};
const clock = { now: () => Date.now() };
const random = (size: number): Uint8Array => randomBytes(size);
const readText = (file: string): Promise<string> => readFile(file, "utf8");
// SP-2: every key variable Codaryn knows.
const currentKey = (): string[] => knownKeyValues(process.env);

/** One line typed at the terminal, or null when the input ends first. `output` shows the question. */
async function askLine(question: string, output: NodeJS.WritableStream = process.stdout): Promise<string | null> {
  const prompt = createInterface({ input: process.stdin, output });
  try {
    return await prompt.question(question);
  } catch {
    return null;
  } finally {
    prompt.close();
  }
}

// A closed stderr (EPIPE) must not end a run: human output is best effort.
process.stderr.on("error", () => {});

/** Writes human text to stderr: keys hidden first, then control characters replaced (N-23 h). */
function writeHuman(text: string): void {
  if (quiet || text.length === 0) return;
  try {
    const clean = cleanText(hideKeys(text, currentKey()), true).replace(/\t/g, " ");
    process.stderr.write(clean.endsWith("\n") ? clean : `${clean}\n`);
  } catch {
    // Human output is best effort.
  }
}

/** N-4: CODARYN_LANG → the config file's `language` → the OS display language → en. */
function language(configLanguage: MessageLanguage | null): MessageLanguage {
  return selectMessageLanguage({ env: process.env[CODARYN_LANG_ENV] ?? null, config: configLanguage, osLocale: runtimeLocale() });
}

function humanFor(configLanguage: MessageLanguage | null): { readonly output: HumanOutput; readonly messages: MessageCatalog } {
  const messages = createMessageCatalog(language(configLanguage));
  return { output: createHumanOutput(messages), messages };
}

/**
 * N-5, N-22, N-25: what happened, how to fix it and the code. The renderer adds the doctor hint
 * itself (N-22); the lock hint is added indented, once (N-D 4.4, `explainedErrorText`).
 */
function explainError(output: CliErrorOutput, human: { readonly output: HumanOutput; readonly messages: MessageCatalog }): void {
  let text = "";
  try {
    text = explainedErrorText(output, human);
  } catch {
    text = "";
  }
  writeHuman(text);
}

async function install(): Promise<InstallInfo | null> {
  try {
    return await findInstall(fileURLToPath(import.meta.url), readText);
  } catch {
    return null;
  }
}

/** os.homedir() can throw when no home directory is known; there is then no default location. */
function homeDirectory(): string | null {
  try {
    return homedir();
  } catch {
    return null;
  }
}

/** The command's outcome and, for `run`, the config file's language for its error text. */
async function dispatch(): Promise<{ readonly outcome: CommandOutcome; readonly configLanguage: MessageLanguage | null }> {
  const plain = (outcome: CommandOutcome) => ({ outcome, configLanguage: null });
  const info = await install();
  // U-3: null means the package root was not found; every run is then refused.
  const installDir = info?.dir ?? null;
  // N-1: the default config location, read when neither --config nor CODARYN_CONFIG is given.
  const home = homeDirectory();
  const defaultConfig = findDefaultConfigLocation(process.platform, process.env, home);
  const defaultRefused = defaultLocationRefused(process.platform, process.env, home);
  // DR-49 (U-23): `codaryn` alone shows the help only at a terminal.
  const asked = helpRequest(argv, { stdoutIsTerminal: process.stdout.isTTY === true });
  if (asked !== null) {
    if (asked.kind === "version") return plain({ text: versionText(info?.version ?? null), exitCode: 0 });
    return plain({ text: helpText(asked.command, humanFor(null).messages), exitCode: 0 });
  }
  const human = humanFor(null);
  // N-23: before `--run latest` acts, say which run it chose.
  const announceLatest = (entry: Parameters<HumanOutput["latestChosen"]>[0]): void => writeHuman(human.output.latestChosen(entry));
  switch (argv[0]) {
    case "revert": {
      const outcome = await runRevert({
        argv,
        // U-16 (R-55 L-1): the hint's lines in the person's language once the catalog has them.
        messages: human.messages,
        cwd: process.cwd(),
        isDirectory,
        clock,
        randomBytes: random,
        revert: createRevertCommand(revertRun, {
          // N-7: the store honours RevertRequest.dryRun, so --dry-run is connected.
          dryRun: revertRun,
          listRuns,
          readRecord: readRevertRecord,
          writeRecord: writeRevertRecord,
          announceLatest,
          // N-26, N-27 (a): the store judges one run as the run list does: an id with no entry of
          // exactly that name is run_not_found, a damaged run is refused.
          inspect: inspectRun,
          // U-16 (UXM-5): a plan run an apply used is told apart; nothing of it is marked reverted.
          loadPlan,
        }),
        // DR-25: at a terminal, files skipped as unsafe_move may go back after a [y/N] question on stderr.
        ...(process.stdin.isTTY === true && process.stderr.isTTY === true ? { ask: (question: string) => askLine(question, process.stderr) } : {}),
      });
      // DR-51 (U-38), R-70 L-1: no typed --workspace (revert knows no registered value).
      if (outcome.output.kind === "revert") writeHuman(human.output.revertSummary(outcome.output));
      if (outcome.hint !== undefined) writeHuman(outcome.hint);
      return plain(outcome);
    }
    case "report":
      return plain(await runReport({ argv, cwd: process.cwd(), env: process.env, listRuns, announceLatest }));
    case "runs":
      return plain(await runRuns({ argv, cwd: process.cwd(), env: process.env, human: human.output }));
    case "changes":
      // DR-7, DR-14: the app layer's `changes` with this process's environment; it reads only.
      // U-36 (R66-M1): the text in the person's language, as plan and apply have it.
      return plain(await runChanges({ argv, env: process.env, app: createCodarynApp(await createNodeAppEnvironment()), messages: human.messages }));
    case "cleanup":
      // DR-39: a preview unless --confirm names the plan digest; people's discarded files need --delete-discarded too.
      return plain(await runCleanup({ argv, cwd: process.cwd(), env: process.env, clock, messages: human.messages }));
    case "plan":
    case "apply":
    case "review": {
      // G-F (DR-17): the task form of `run`, steps 1 to 7 included; no model is involved.
      const shared = {
        argv,
        env: process.env,
        cwd: process.cwd(),
        readFile: readText,
        isDirectory,
        loadEnvFile: (file: string) => process.loadEnvFile(file),
        locateInWorkspace: (file: string, workspaceRoot: string) => locateInWorkspace(file, workspaceRoot),
        relatePaths: (target: string, base: string) => relateRealPaths(target, base),
        installDir,
        defaultConfig,
        clock,
        randomBytes: random,
        listRuns,
        announceLatest,
      };
      if (argv[0] === "plan") return plain(await runPlan({ ...shared, messages: human.messages }));
      if (argv[0] === "review") return plain(await runReview({ ...shared, messages: human.messages }));
      return plain(
        await runApply({
          ...shared,
          messages: human.messages,
          human: human.output,
          writeProgress: (line) => writeHuman(line),
          // 6.4 1: at a terminal without --digest the plan is shown and a [y/N] question asked on stderr.
          ...(process.stdin.isTTY === true && process.stderr.isTTY === true ? { ask: (question: string) => askLine(question, process.stderr) } : {}),
          cancelSignal: (cancelFile) =>
            createCancelSource({
              cancelFile,
              fileExists: (file) => existsSync(file),
              onSignal: (name, handler) => {
                process.on(name, handler);
                return () => process.off(name, handler);
              },
            }),
        }),
      );
    }
    case "init":
      return plain(
        await runInit({
          argv,
          env: process.env,
          cwd: process.cwd(),
          defaultConfig,
          defaultConfigRefused: defaultRefused,
          messages: human.messages,
          readFile: readText,
          isDirectory,
          exists,
          locateInWorkspace: (file, workspaceRoot) => locateInWorkspace(file, workspaceRoot),
          makeDirectory: async (dir) => {
            await mkdir(dir, { recursive: true });
          },
          writeNewFile: (file, text) => writeFile(file, text, { encoding: "utf8", flag: "wx" }),
          // N-2: questions only when stdin and stderr are terminals; they go to stderr.
          ...(process.stdin.isTTY === true && process.stderr.isTTY === true
            ? { ask: (question: string) => askLine(question, process.stderr), tell: (line: string) => writeHuman(line) }
            : {}),
          listModels: anthropicModelLister,
        }),
      );
    case "models":
      return plain(
        await runModels({
          argv,
          env: process.env,
          cwd: process.cwd(),
          readFile: readText,
          // C-2, T-15: only when --vars-file is given. Variables already set in the environment win.
          loadEnvFile: (file) => process.loadEnvFile(file),
          // Y-1, SP-6: each provider's lister through the CLI's provider module (anthropic: listAnthropicModels,
          // openai: listOpenAIModels). One is called only after that provider's key and address are
          // resolved, with the global fetch.
          listModels: anthropicModelLister,
          listers: API_MODEL_LISTERS,
          defaultConfig,
          // Y-3: the number is asked only when both stdin and stdout are terminals.
          ...(process.stdin.isTTY === true && process.stdout.isTTY === true ? { ask: (question: string) => askLine(question) } : {}),
        }),
      );
    case "doctor":
      return plain(
        await runDoctor({
          argv,
          env: process.env,
          cwd: process.cwd(),
          nodeVersion: process.versions.node,
          installDir,
          readFile: readText,
          isDirectory,
          isFile,
          locateInWorkspace: (file, workspaceRoot) => locateInWorkspace(file, workspaceRoot),
          relatePaths: (target, base) => relateRealPaths(target, base),
          defaultConfig,
          defaultConfigRefused: defaultRefused,
          messages: human.messages,
          osLocale: runtimeLocale(),
          // N-20: where the language came from, for the `language` check.
          explainLanguage: explainMessageLanguage,
        }),
      );
    default: {
      const outcome = await runCli({
        argv,
        env: process.env,
        cwd: process.cwd(),
        readFile: readText,
        isDirectory,
        // C-2, T-15: only when --vars-file is given. Variables already set in the environment win.
        loadEnvFile: (file) => process.loadEnvFile(file),
        // S-1: real paths, so links and 8.3 names cannot hide a file inside the workspace.
        locateInWorkspace: (file, workspaceRoot) => locateInWorkspace(file, workspaceRoot),
        clock,
        randomBytes: random,
        assemble: assembleRun,
        installDir,
        relatePaths: (target, base) => relateRealPaths(target, base),
        defaultConfig,
        human: humanFor,
        writeProgress: (line) => {
          process.stderr.write(line);
        },
        cancelSignal: (cancelFile) =>
          createCancelSource({
            cancelFile,
            fileExists: (file) => existsSync(file),
            onSignal: (name, handler) => {
              process.on(name, handler);
              return () => process.off(name, handler);
            },
          }),
      });
      return { outcome, configLanguage: outcome.info?.configLanguage ?? null };
    }
  }
}

let configLanguage: MessageLanguage | null = null;
const outcome = await runGuardedCommand(async () => {
  const dispatched = await dispatch();
  configLanguage = dispatched.configLanguage;
  return dispatched.outcome;
});
if ("output" in outcome && outcome.output.kind === "error") {
  try {
    explainError(outcome.output, humanFor(configLanguage));
  } catch {
    // Human output is best effort.
  }
}
// DR-49 (U-23): at a terminal the JSON line after the human text is left out (stdoutText);
// U-45 (R-58 Q-1): only when stderr, where that text goes, is a terminal too.
const written = stdoutText(outcome, { argv, stdoutIsTerminal: process.stdout.isTTY === true, stderrIsTerminal: process.stderr.isTTY === true });
if (written.length > 0) process.stdout.write(written);
process.exitCode = outcome.exitCode;
