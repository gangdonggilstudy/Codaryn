/**
 * Usability cases (N-E): the user's default config location inside the sandbox, and readers for
 * the outputs of `init` and `runs` (docs/cli-contract.md section 17).
 *
 * The default location (N-1) is `%APPDATA%\Codaryn\config.json` on Windows and
 * `$XDG_CONFIG_HOME/codaryn/config.json` elsewhere. Every case that uses it points that variable
 * into the sandbox, so no run ever reads or writes the developer's own config.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, isAbsolute } from "node:path";
import { DEFAULT_CONFIG_DISPLAY } from "../../src/contracts/index.js";
import type { InitOutput, RunsOutput } from "../../src/contracts/index.js";
import type { Sandbox } from "../fixtures/builders.js";
import type { CliRun } from "./cli.js";
import { parseCommandOutput } from "./repair-check.js";

export const IS_WINDOWS = process.platform === "win32";

export interface UserConfigLocation {
  /** Variables that point the default location into the sandbox (APPDATA or XDG_CONFIG_HOME). */
  readonly env: Readonly<Record<string, string>>;
  /** The folder the variable names. */
  readonly root: string;
  /** Where N-1 looks: `<root>/Codaryn/config.json` or `<root>/codaryn/config.json`. */
  readonly path: string;
  /** The symbolic form outputs use instead of the path (DEFAULT_CONFIG_DISPLAY). */
  readonly display: string;
}

/** The default config location for this sandbox. `root` defaults to `<base>/user-config`. */
export function userConfigLocation(sandbox: Sandbox, root: string = join(sandbox.base, "user-config")): UserConfigLocation {
  const inside = relative(sandbox.base, root);
  assert.ok(inside !== "" && !inside.startsWith("..") && !isAbsolute(inside), "the user config root must lie inside the sandbox");
  return IS_WINDOWS
    ? { env: { APPDATA: root }, root, path: join(root, "Codaryn", "config.json"), display: DEFAULT_CONFIG_DISPLAY.windows }
    : { env: { XDG_CONFIG_HOME: root }, root, path: join(root, "codaryn", "config.json"), display: DEFAULT_CONFIG_DISPLAY.xdg };
}

/** Writes a config file at the default location and returns its path. */
export function writeUserConfig(location: UserConfigLocation, config: object): string {
  mkdirSync(dirname(location.path), { recursive: true });
  writeFileSync(location.path, JSON.stringify(config, null, 2));
  return location.path;
}

export function expectInitOutput(run: CliRun): InitOutput {
  const output = parseCommandOutput(run);
  if (output.kind !== "init") assert.fail(`expected an init result, got ${JSON.stringify(output).slice(0, 500)}`);
  return output;
}

export function expectRunsOutput(run: CliRun): RunsOutput {
  const output = parseCommandOutput(run);
  if (output.kind !== "runs") assert.fail(`expected a runs result, got ${JSON.stringify(output).slice(0, 500)}`);
  assert.equal(output.exitCode, 0);
  return output;
}

/** Text in stdout and stderr: neither may hold `values` (expanded paths, keys). */
export function assertNotPrinted(run: CliRun, values: readonly string[], what = "a path or value"): void {
  for (const value of values) {
    assert.ok(!run.stdout.includes(value) && !run.stderr.includes(value), `${what} must not be printed`);
    // JSON escapes backslashes, so look for the escaped form too.
    const escaped = JSON.stringify(value).slice(1, -1);
    assert.ok(!run.stdout.includes(escaped), `${what} must not be printed (JSON form)`);
  }
}
