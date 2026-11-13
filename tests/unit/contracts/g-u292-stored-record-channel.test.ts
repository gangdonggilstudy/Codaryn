/**
 * U-292 (C-6a, PM after U-289's secret-in-closed-word case): RunObserver.onStoredRecord gives a run's
 * records as the journal stored them, with the engine's masking only (closed words as written). It
 * is for an adapter that draws people's lines in its own process, as the CLI does. A host that
 * hands anything of a run to a window or over IPC never uses it (the contract's comment).
 *
 * This test holds the GUI to that from its source: no file under gui/src names the channel. That
 * covers the engine host, which builds its run observers, and the main process, preload and window,
 * which get what the host passes on. The channel's name comes from the contract's type, so a rename
 * there fails to compile here instead of leaving the test looking for a name nobody uses. The scan
 * must find the engine host's run file, and in it the observer the host does give (onEvent), so it
 * cannot pass on an empty or wrong folder. It reads the GUI's sources and changes nothing.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import type { RunObserver } from "../../../src/contracts/app.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const GUI_SOURCES = path.join(repoRoot, "gui", "src");
const SOURCE_FILE = /\.(?:[cm]?ts|tsx|[cm]?js)$/;

/** The contract's name of the channel: a rename of the field fails to compile here. */
const CHANNEL: keyof RunObserver = "onStoredRecord";
/** The observer method the engine host does give its runs (the positive control). */
const EVENTS: keyof RunObserver = "onEvent";

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
    assert.match(readFileSync(runs, "utf8"), new RegExp(`\\b${EVENTS}\\b`), "the host's run observer gives onEvent");
  });

  test("no GUI source names onStoredRecord: the engine host's observers give onEvent and confirm only", () => {
    const naming = files.filter((file) => readFileSync(file, "utf8").includes(CHANNEL)).map(relative);
    assert.deepEqual(naming, []);
  });
});
