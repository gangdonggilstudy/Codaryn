/**
 * U-292 (C-6a, PM after U-289's secret-in-closed-word case): RunObserver.onStoredRecord gives a run's
 * records as the journal stored them, with the engine's masking only (closed words as written). It
 * is for an adapter that draws people's lines in its own process, as the CLI does. A host that
 * hands anything of a run to a window or over IPC never uses it (the contract's comment). U-309
 * (C-7b, PM D-4): the same rule for an apply's ApplyObserver.onStoredRecord and onStoredRunRecord.
 *
 * This test holds the GUI to that from its source: no file under gui/src names the channel. That
 * covers the engine host, which builds its run observers, and the main process, preload and window,
 * which get what the host passes on. The channels' names come from the contract's types, every
 * `onStored…` of both observers, so a rename or a new one there fails to compile here instead of
 * leaving the test looking for names nobody uses. The scan must find the engine host's run file,
 * and in it the observers the host does give (onEvent, and an apply's onRunEvent), so it cannot pass
 * on an empty or wrong folder. It reads the GUI's sources and changes nothing.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import type { ApplyObserver, RunObserver } from "../../../src/contracts/app.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const GUI_SOURCES = path.join(repoRoot, "gui", "src");
const SOURCE_FILE = /\.(?:[cm]?ts|tsx|[cm]?js)$/;

/** The contract's stored-record channels, every `onStored…` of both observers: a rename or a new one fails to compile here. */
const RUN_CHANNELS = ["onStoredRecord"] as const satisfies readonly (keyof RunObserver)[];
const APPLY_CHANNELS = ["onStoredRecord", "onStoredRunRecord"] as const satisfies readonly (keyof ApplyObserver)[];
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const COMPLETE: [Same<Extract<keyof RunObserver, `onStored${string}`>, (typeof RUN_CHANNELS)[number]>, Same<Extract<keyof ApplyObserver, `onStored${string}`>, (typeof APPLY_CHANNELS)[number]>] = [true, true];
const CHANNELS: readonly string[] = [...new Set<string>([...RUN_CHANNELS, ...APPLY_CHANNELS])];
/** The observer methods the engine host does give its runs and applies (the positive control). */
const EVENTS: readonly string[] = ["onEvent" satisfies keyof RunObserver, "onRunEvent" satisfies keyof ApplyObserver];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (SOURCE_FILE.test(name)) found.push(full);
  }
  return found;
}

const relative = (file: string): string => path.relative(repoRoot, file).split(path.sep).join("/");

describe("U-292: the GUI never takes the stored records", () => {
  const files = sourceFiles(GUI_SOURCES);
  const engineHost = files.filter((file) => relative(file).startsWith("gui/src/engine-host/"));

  test("the scan reads the GUI's sources, the engine host's run observer among them", () => {
    assert.ok(engineHost.length >= 10, `engine host files: ${engineHost.map(relative).join(", ")}`);
    const runs = engineHost.find((file) => relative(file) === "gui/src/engine-host/runs.ts");
    assert.ok(runs !== undefined, "gui/src/engine-host/runs.ts");
    const text = readFileSync(runs, "utf8");
    for (const name of EVENTS) assert.match(text, new RegExp(`\\b${name}\\b`), `the host's observers give ${name}`);
    assert.deepEqual(COMPLETE, [true, true]);
  });

  test("no GUI source names a stored-record channel: the engine host's observers give events and confirm only", () => {
    assert.deepEqual(CHANNELS, ["onStoredRecord", "onStoredRunRecord"]);
    const naming = files.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return CHANNELS.filter((channel) => text.includes(channel)).map((channel) => `${relative(file)}: ${channel}`);
    });
    assert.deepEqual(naming, []);
  });
});
