/**
 * U-318 (ne-verify's R-119 L-1): reverting a run that made a file whose name holds a registered secret
 * skips two entries: the journal's masked path (missing_snapshot) and the real file from the snapshot
 * index (missing_record), whose path comes unmasked (SkippedFile). The CLI's summary prints "?" for every
 * missing_record path (src/cli/human/output.ts, HIDDEN_PATH); the GUI showed each skipped path as it
 * came, so the secret's text reached the window. Now the engine host leaves a missing_record path out
 * (the CLI's rule, by the reason alone), so it never crosses to the main process, the main process keeps
 * none even if one came, and the window shows "?" with a note. The real app (the root build), a real run
 * and its revert, preview and done. The CLI's --json, which holds the path, is not this unit's.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { revertValue } from "../../src/engine-host/history.js";
import { asRevert } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { KO } from "../../src/renderer/i18n/ko.js";
import { revertList } from "../../src/renderer/runs/runs-screen.js";
import { toRevertView } from "../../src/shared/ipc.js";
import { FakeElement, installFakeDom } from "./fake-dom.js";

// This file runs as gui/build/tests/unit/u318-revert-hidden-path.test.js.
const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const DIST = path.join(GUI, "..", "dist");
const load = async <T>(...parts: string[]): Promise<T> => (await import(pathToFileURL(path.join(DIST, ...parts)).href)) as T;

type Outcome = { readonly ok: boolean; readonly output?: { readonly skipped?: readonly { readonly path: string; readonly reason: string }[] } };
const appModule = await load<{ createCodarynApp(environment: unknown): { startRun(request: unknown): Promise<{ ok: boolean; handle: { runId: string; done: Promise<{ ok: boolean }> } }>; revert(request: unknown): Promise<Outcome> } }>("src", "app", "index.js");
const support = await load<{ FAKE_SECRET: string; WRITE_NOTES: unknown; setupRun(files: Record<string, string>, task: Record<string, unknown>, steps: readonly unknown[]): Promise<string>; appEnvironment(base: string): Promise<unknown>; taskRequest(base: string): unknown }>("tests", "unit", "app", "support.js");
const safety = await load<{ cleanText(text: string): string; hideKeys(text: string, currentKey: string | null): string }>("src", "cli", "text-safety.js");
/** The engine host's `shown` (engine-host/main.ts), with no key variable set: it hides key shapes, not registered values. */
const shown = (text: string): string => safety.hideKeys(safety.cleanText(text), null);

test("U-318 (R-119 L-1): a missing_record path, which comes unmasked, reaches neither the main process nor the window", async () => {
  const SECRET = support.FAKE_SECRET;
  const steps = [
    { toolCalls: [{ name: "write_file", args: { path: `notes/${SECRET}.md`, expectedHash: null, change: { kind: "replace_all", content: "secret-named\n" } } }] },
    support.WRITE_NOTES,
    { text: "done" },
  ];
  const base = await support.setupRun({}, {}, steps);
  const work = path.join(base, "work");
  const app = appModule.createCodarynApp(await support.appEnvironment(base));
  const started = await app.startRun(support.taskRequest(base));
  assert.ok(started.ok, JSON.stringify(started));
  const done = await started.handle.done;
  assert.ok(done.ok, JSON.stringify(done));
  const restore = installFakeDom();
  try {
    for (const dryRun of [true, false]) {
      const outcome = await app.revert({ workspace: work, runId: started.handle.runId, dryRun });
      // What the app gives (as the CLI's --json does): the real name under missing_record.
      const raw = (outcome.output?.skipped ?? []).filter((file) => file.reason === "missing_record");
      assert.ok(raw.length === 1 && raw[0]?.path.includes(SECRET), `the case R-119 found (${dryRun ? "preview" : "revert"}): ${JSON.stringify(outcome.output?.skipped)}`);
      // The engine host's value is what it writes to the main process: no secret in it.
      const value = revertValue(outcome, shown);
      assert.equal(JSON.stringify(value).includes(SECRET), false, "the host's line to the main process holds no registered value");
      const view = toRevertView(value);
      assert.ok(view.ok, JSON.stringify(view));
      assert.deepEqual(view.view.skipped.filter((file) => file.reason === "missing_record"), [{ path: null, reason: "missing_record" }]);
      assert.ok(view.view.skipped.some((file) => file.reason === "missing_snapshot" && typeof file.path === "string" && file.path.startsWith("notes/")), "the journal's masked path is still shown");
      // The window: "?" for it, as the CLI's summary, and a note why.
      const reply = asRevert({ ok: true, view: view.view, preview: null, consentRetry: null });
      assert.ok(reply.ok);
      const root = new FakeElement("div");
      root.append(...(revertList(textsFor("ko"), reply.view) as unknown as FakeElement[]));
      const hidden = root.findAll((e) => e.getAttribute("data-reason") === "missing_record");
      assert.equal(hidden.length, 1);
      assert.ok(hidden[0]?.textContent.startsWith("?: "), String(hidden[0]?.textContent));
      assert.equal(root.textContent.includes(SECRET), false);
      const note = (KO as Readonly<Record<string, string>>)["runs.skipPathHidden"];
      assert.ok(note !== undefined && root.textContent.includes(note), "the note says why the path is not shown");
    }
  } finally {
    restore();
  }
});

test("U-318 (R-119 L-1): the main process keeps no missing_record path, and asks one of every other skip", () => {
  const value = (skipped: readonly unknown[]) => ({ ok: true, runId: "20261114T090000Z-0000a318", status: "partial", dryRun: true, reverted: [], skipped, moveSafetyUnchecked: false, revertedBefore: null });
  const came = toRevertView(value([{ path: "notes/as-it-came.md", reason: "missing_record" }]));
  assert.ok(came.ok);
  assert.deepEqual(came.view.skipped, [{ path: null, reason: "missing_record" }], "a path that came is dropped");
  assert.equal(toRevertView(value([{ path: null, reason: "changed_since_run" }])).ok, false, "only missing_record goes without a path");
  const kept = toRevertView(value([{ path: "a.txt", reason: "changed_since_run" }]));
  assert.ok(kept.ok);
  assert.deepEqual(kept.view.skipped, [{ path: "a.txt", reason: "changed_since_run" }]);
});
