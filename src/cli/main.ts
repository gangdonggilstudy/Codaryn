#!/usr/bin/env node
/**
 * Process entry point. Writes exactly one JSON line to stdout and exits with its code.
 * `codaryn revert ...` goes to runRevert, everything else to runCli (`run`, or a usage error).
 */

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { assembleRun } from "./assemble.js";
import { createCancelSource } from "./cancel.js";
import { runRevert } from "./revert.js";
import { runCli } from "./run.js";

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

const outcome =
  argv[0] === "revert"
    ? await runRevert({
        argv,
        cwd: process.cwd(),
        isDirectory,
        clock,
        randomBytes: random,
        // `revert` stays unset until the store's revertRun is connected (createRevertCommand).
      })
    : await runCli({
        argv,
        env: process.env,
        cwd: process.cwd(),
        readFile: (file) => readFile(file, "utf8"),
        isDirectory,
        // C-2: only when --env-file is given. Variables already set in the environment win.
        loadEnvFile: (file) => process.loadEnvFile(file),
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
      });

process.stdout.write(`${JSON.stringify(outcome.output)}\n`);
process.exitCode = outcome.exitCode;
