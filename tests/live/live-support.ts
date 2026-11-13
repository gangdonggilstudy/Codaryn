/**
 * What the real API checks share (U-101): the switch, the skip reason, the environment passed to the
 * CLI, and reading its one JSON line. Not a test file, so importing it registers no test.
 */

import assert from "node:assert/strict";
import { CHILD_ENV_ALLOWLIST } from "../../src/contracts/index.js";
import type { CliOutput } from "../../src/contracts/index.js";

/** Must equal "1" for a live check to run. */
export const LIVE_SWITCH_ENV = "CODARYN_LIVE";

/** False when the switch and every named variable are set; else why the check is skipped. */
export function liveSkipReason(label: string, names: readonly string[]): string | false {
  const missing: string[] = [];
  if (process.env[LIVE_SWITCH_ENV] !== "1") missing.push(`${LIVE_SWITCH_ENV}=1`);
  for (const name of names) if ((process.env[name] ?? "") === "") missing.push(name);
  return missing.length === 0 ? false : `실제 API 점검(${label}) 건너뜀: ${missing.join(", ")} 없음`;
}

/**
 * CHILD_ENV_ALLOWLIST plus the named variables (a key and a model). Nothing else: no CODARYN_CONFIG
 * and no address variable, so the explicit config file and the official address are used.
 */
export function liveEnvWith(names: readonly string[]): NodeJS.ProcessEnv {
  const allow = new Set<string>(CHILD_ENV_ALLOWLIST);
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && allow.has(name.toUpperCase())) env[name] = value;
  }
  for (const name of names) env[name] = process.env[name];
  return env;
}

/** The CLI's one JSON line on stdout (a run's output or an error unless said otherwise). */
export function jsonLine<T = CliOutput>(stdout: string): T {
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim() !== "");
  assert.equal(lines.length, 1, "stdout must be one JSON line");
  return JSON.parse(lines[0] ?? "") as T;
}
