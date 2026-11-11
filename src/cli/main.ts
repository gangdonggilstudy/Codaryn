#!/usr/bin/env node
/**
 * Process entry point. Writes exactly one JSON line to stdout and exits with its code.
 */

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { assembleRun } from "./assemble.js";
import { createCancelSource } from "./cancel.js";
import { runCli } from "./run.js";

const outcome = await runCli({
  argv: process.argv.slice(2),
  env: process.env,
  cwd: process.cwd(),
  readFile: (file) => readFile(file, "utf8"),
  isDirectory: async (dir) => {
    try {
      return (await stat(dir)).isDirectory();
    } catch {
      return false;
    }
  },
  // C-2: only when --env-file is given. Variables already set in the environment win.
  loadEnvFile: (file) => process.loadEnvFile(file),
  clock: { now: () => Date.now() },
  randomBytes: (size) => randomBytes(size),
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
