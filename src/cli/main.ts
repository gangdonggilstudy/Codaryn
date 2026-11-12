#!/usr/bin/env node
/**
 * Process entry point (`bin.codaryn` in package.json). Writes exactly one output to stdout and
 * exits with its code: one JSON line for `run` and `revert` (and errors of every command), text
 * for `report`, `doctor`, `models`, `runs`, `init`, `--help` and `--version` (`--json` makes
 * report, doctor, models, runs and init print JSON). Every JSON line is ASCII (N-19).
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
import { CODARYN_LANG_ENV, DOCTOR_HINT_ERROR_CODES } from "../contracts/index.js";
import type { CliErrorOutput, HumanOutput, MessageCatalog, MessageLanguage } from "../contracts/index.js";
import { createMessageCatalog, explainMessageLanguage, runtimeLocale, selectMessageLanguage } from "../i18n/index.js";
import { inspectRun, listRuns, readRevertRecord, revertRun, writeRevertRecord } from "../store/index.js";
import { assembleRun, createRevertCommand } from "./assemble.js";
import { createCancelSource } from "./cancel.js";
import { defaultLocationRefused, findDefaultConfigLocation } from "./config-file.js";
import { runDoctor } from "./doctor.js";
import { renderOutcome, runGuardedCommand } from "./guard.js";
import type { CommandOutcome } from "./guard.js";
import { helpRequest, helpText, versionText } from "./help.js";
import { createHumanOutput } from "./human/index.js";
import { runInit } from "./init.js";
import { findInstall } from "./install.js";
import type { InstallInfo } from "./install.js";
import { runModels } from "./models.js";
import { runApply, runPlan, runReview } from "./plan-commands.js";
import { anthropicModelLister } from "./provider.js";
import { runReport } from "./report.js";
import { runRevert } from "./revert.js";
import { runCli } from "./run.js";
import { runRuns } from "./runs.js";
import { locateInWorkspace, relateRealPaths } from "./security/index.js";
import { envValue } from "./settings.js";
import { cleanText, hideKeys } from "./text-safety.js";

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
const currentKey = (): string | null => envValue(process.env, "ANTHROPIC_API_KEY");

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

/** N-5, N-22, N-25: what happened, how to fix it, the code, and `doctor` or the lock hint where they help. */
function explainError(output: CliErrorOutput, human: { readonly output: HumanOutput; readonly messages: MessageCatalog }): void {
  let text = "";
  try {
    text = human.output.error(output);
    // The renderer may already add these hints; each is written once.
    const hints: string[] = [];
    if ((DOCTOR_HINT_ERROR_CODES as readonly string[]).includes(output.code)) hints.push(human.messages.format("error.doctor_hint"));
    if (output.code === "workspace_locked") hints.push(human.messages.format("lock.remove_hint"));
    for (const hint of hints) if (!text.includes(hint)) text += `${hint}\n`;
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
  const asked = helpRequest(argv);
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
          // N-26: the store judges one run as the run list does.
          isDamaged: async (workspaceRoot, runId) => (await inspectRun(workspaceRoot, runId)) === "damaged",
        }),
      });
      if (outcome.output.kind === "revert") writeHuman(human.output.revertSummary(outcome.output));
      return plain(outcome);
    }
    case "report":
      return plain(await runReport({ argv, cwd: process.cwd(), env: process.env, listRuns, announceLatest }));
    case "runs":
      return plain(await runRuns({ argv, cwd: process.cwd(), env: process.env, human: human.output }));
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
      if (argv[0] === "plan") return plain(await runPlan(shared));
      if (argv[0] === "review") return plain(await runReview(shared));
      return plain(
        await runApply({
          ...shared,
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
          // Y-1: listAnthropicModels (src/model/anthropic) through the CLI's provider module. It is
          // called only after the key and the address are resolved, with the global fetch.
          listModels: anthropicModelLister,
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
process.stdout.write(renderOutcome(outcome));
process.exitCode = outcome.exitCode;
