#!/usr/bin/env node
/**
 * Process entry point (`bin.codaryn` in package.json). Writes exactly one output to stdout and
 * exits with its code: one JSON line for `run` and `revert` (and errors of every command), text
 * for `report`, `doctor`, `models`, `--help` and `--version` (`--json` makes report, doctor and
 * models print JSON). `run` writes progress lines to stderr unless `--quiet` is given (U-8).
 * `models` may ask for a number at a terminal (Y-3); the question goes to stdout.
 * Any exception becomes `internal_error` (exit code 70) without its text or stack (S-6).
 */

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { revertRun } from "../store/index.js";
import { assembleRun, createRevertCommand } from "./assemble.js";
import { createCancelSource } from "./cancel.js";
import { runDoctor } from "./doctor.js";
import { runModels } from "./models.js";
import { anthropicModelLister } from "./provider.js";
import { renderOutcome, runGuardedCommand } from "./guard.js";
import type { CommandOutcome } from "./guard.js";
import { helpRequest, helpText, versionText } from "./help.js";
import { findInstall } from "./install.js";
import type { InstallInfo } from "./install.js";
import { runReport } from "./report.js";
import { runRevert } from "./revert.js";
import { runCli } from "./run.js";
import { locateInWorkspace, relateRealPaths } from "./security/index.js";

const argv = process.argv.slice(2);
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
const clock = { now: () => Date.now() };
const random = (size: number): Uint8Array => randomBytes(size);
const readText = (file: string): Promise<string> => readFile(file, "utf8");

/** One line typed at the terminal, or null when the input ends first. */
async function askLine(question: string): Promise<string | null> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await prompt.question(question);
  } catch {
    return null;
  } finally {
    prompt.close();
  }
}

// A closed stderr (EPIPE) must not end a run: progress is best effort.
process.stderr.on("error", () => {});

async function install(): Promise<InstallInfo | null> {
  try {
    return await findInstall(fileURLToPath(import.meta.url), readText);
  } catch {
    return null;
  }
}

async function dispatch(): Promise<CommandOutcome> {
  const info = await install();
  // U-3: null means the package root was not found; every run is then refused.
  const installDir = info?.dir ?? null;
  const asked = helpRequest(argv);
  if (asked !== null) {
    return { text: asked.kind === "version" ? versionText(info?.version ?? null) : helpText(asked.command), exitCode: 0 };
  }
  switch (argv[0]) {
    case "revert":
      return runRevert({
        argv,
        cwd: process.cwd(),
        isDirectory,
        clock,
        randomBytes: random,
        revert: createRevertCommand(revertRun),
      });
    case "report":
      return runReport({ argv, cwd: process.cwd(), env: process.env });
    case "models":
      return runModels({
        argv,
        env: process.env,
        cwd: process.cwd(),
        readFile: readText,
        // C-2, T-15: only when --vars-file is given. Variables already set in the environment win.
        loadEnvFile: (file) => process.loadEnvFile(file),
        // Y-1: listAnthropicModels (src/model/anthropic) through the CLI's provider module. It is
        // called only after the key and the address are resolved, with the global fetch.
        listModels: anthropicModelLister,
        // Y-3: the number is asked only when both stdin and stdout are terminals.
        ...(process.stdin.isTTY === true && process.stdout.isTTY === true ? { ask: askLine } : {}),
      });
    case "doctor":
      return runDoctor({
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
      });
    default:
      return runCli({
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
  }
}

const outcome = await runGuardedCommand(dispatch);
process.stdout.write(renderOutcome(outcome));
process.exitCode = outcome.exitCode;
