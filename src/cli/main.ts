#!/usr/bin/env node
/**
 * Process entry point. Writes exactly one JSON line to stdout and exits with its code.
 * `codaryn revert ...` goes to runRevert, everything else to runCli (`run`, or a usage error).
 * Any exception becomes `internal_error` (exit code 70) without its text or stack (S-6).
 */

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { revertRun } from "../store/index.js";
import { assembleRun, createRevertCommand } from "./assemble.js";
import { createCancelSource } from "./cancel.js";
import { runGuarded } from "./guard.js";
import { runRevert } from "./revert.js";
import { runCli } from "./run.js";
import { locateInWorkspace } from "./security/index.js";

const argv = process.argv.slice(2);
const isDirectory = async (dir: string): Promise<boolean> => {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
};
const clock = { now: () => Date.now() };
const random = (size: number): Uint8Array => randomBytes(size);

const outcome = await runGuarded(() =>
  argv[0] === "revert"
    ? runRevert({
        argv,
        cwd: process.cwd(),
        isDirectory,
        clock,
        randomBytes: random,
        revert: createRevertCommand(revertRun),
      })
    : runCli({
        argv,
        env: process.env,
        cwd: process.cwd(),
        readFile: (file) => readFile(file, "utf8"),
        isDirectory,
        // C-2, T-15: only when --vars-file is given. Variables already set in the environment win.
        loadEnvFile: (file) => process.loadEnvFile(file),
        // S-1: real paths, so links and 8.3 names cannot hide a file inside the workspace.
        locateInWorkspace: (file, workspaceRoot) => locateInWorkspace(file, workspaceRoot),
        clock,
        randomBytes: random,
        assemble: assembleRun,
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

process.stdout.write(`${JSON.stringify(outcome.output)}\n`);
process.exitCode = outcome.exitCode;
