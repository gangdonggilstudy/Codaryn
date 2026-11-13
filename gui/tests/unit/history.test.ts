/**
 * GU-4: the run list and reverting. The engine host's calls with a fake app (src/engine-host/
 * history.ts), the main process's checks (src/shared/ipc.ts) and what it remembers between a list,
 * a preview and the revert (src/main/history.ts).
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { test } from "node:test";

import { createHostHandler } from "../../src/engine-host/host.js";
import { PREVIEW_TTL_MS, RunHistory } from "../../src/main/history.js";
import { parsePreviewArgs, parseRetryArgs, parseRunArgs, toRevertView, toRunsReply } from "../../src/shared/ipc.js";
import { parseHostMessage } from "../../src/shared/protocol.js";
import type { HostMessage } from "../../src/shared/protocol.js";
import { fakeApp } from "./fake-app.js";

const WS = path.resolve("ws-for-history");
const RUN_A = "20261112T010203Z-0000abcd";
const RUN_B = "20261112T020304Z-0000beef";
const HANDLE = "1".repeat(32);

function host(app: Parameters<typeof fakeApp>[0]) {
  const written: HostMessage[] = [];
  const handler = createHostHandler({
    app: fakeApp(app),
    messages: { texts: () => ({ language: "en", texts: {} }) },
    tree: async () => null,
    shown: (text) => `<${text}>`,
    providers: [],
    itemsIn: () => () => null,
    token: () => "0".repeat(32),
    write: (line) => written.push(parseHostMessage(line.trimEnd()) as HostMessage),
    log: () => undefined,
  });
  return async (id: number, call: string, args: unknown): Promise<unknown> => {
    await handler.handleLine(JSON.stringify({ v: 1, id, call, args }));
    const message = written.find((m) => "id" in m && m.id === id) as { ok: boolean; value?: unknown; error?: { code: string } };
    return message.ok ? message.value : message.error?.code;
  };
}

test("history (GU-4): the run list keeps run ids, cleans task ids, and keeps only the id of a damaged run", async () => {
  const calls: unknown[] = [];
  const call = host({
    listRuns: async (request) => {
      calls.push(request);
      return {
        ok: true,
        output: {
          kind: "runs",
          runs: [
            { state: "checked", runId: RUN_A, kind: "run", startedAt: "2026-11-12T01:02:03.000Z", taskId: "task\u0007", status: "done", reason: "verified", changes: 2, reverted: null },
            { state: "checked", runId: RUN_B, kind: "apply", planRunId: RUN_A, startedAt: "2026-11-12T02:03:04.000Z", taskId: "t", status: null, reason: null, changes: null, reverted: { at: "2026-11-12T03:00:00.000Z", status: "partial" }, revertRecordDamaged: true },
            { state: "damaged", runId: "20261112T030405Z-0000dead", taskId: "never shown" },
            { state: "checked", runId: "latest", kind: "run" },
          ],
          omitted: 3,
        },
      };
    },
  });
  const value = await call(1, "listRuns", { workspace: WS });
  assert.deepEqual(calls, [{ workspace: WS, limit: 200 }]);
  const reply = toRunsReply(value);
  assert.equal(reply.ok, true);
  if (!reply.ok) return;
  assert.equal(reply.runs.length, 3, "a row without a run id is left out");
  assert.deepEqual(reply.runs[0], { state: "checked", runId: RUN_A, kind: "run", startedAt: "2026-11-12T01:02:03.000Z", taskId: "<task\u0007>", status: "done", reason: "verified", changes: 2, reverted: null, revertRecordDamaged: false, recordsChanged: false, planApply: null });
  assert.deepEqual(reply.runs[1]?.state === "checked" && reply.runs[1].reverted, { at: "2026-11-12T03:00:00.000Z", status: "partial" });
  assert.deepEqual(reply.runs[2], { state: "damaged", runId: "20261112T030405Z-0000dead" });
  assert.equal(JSON.stringify(value).includes("never shown"), false);
  assert.equal(reply.omitted, 3);
  assert.equal(await call(2, "listRuns", { workspace: "relative" }), "invalid_args");
  assert.equal(await call(3, "listRuns", { workspace: WS, limit: 5 }), "invalid_args");
});

test("history (GU-4): a revert names a run id, never latest; its paths are cleaned and its errors are codes", async () => {
  const calls: unknown[] = [];
  const call = host({
    revert: async (request) => {
      calls.push(request);
      if (request.runId === RUN_B) return { ok: false, error: { code: "workspace_locked", message: "lock at C:\\x" } };
      const exploded = request.dryRun ? [{ path: "c.txt", action: "exploded" }] : [];
      return {
        ok: true,
        output: {
          kind: "revert",
          runId: RUN_A,
          status: "partial",
          exitCode: 3,
          ...(request.dryRun ? { dryRun: true } : {}),
          reverted: [{ path: "a.txt", action: "deleted" }, { path: "b.txt", action: "moved_back", from: "x/b.txt", unsafe: true }, ...exploded],
          skipped: [{ path: "d.txt", reason: "changed_since_run" }],
          moveSafetyUnchecked: true,
        },
      };
    },
  });
  for (const [id, args] of [
    [1, { workspace: WS, runId: "latest", dryRun: true }],
    [2, { workspace: WS, runId: RUN_A, dryRun: "yes" }],
    [3, { workspace: "rel", runId: RUN_A, dryRun: true }],
    [4, { workspace: WS, runId: RUN_A, dryRun: true, unsafeMoveConsent: { runId: RUN_A } }],
  ] as const) {
    assert.equal(await call(id, "revert", args), "invalid_args", `request ${id}`);
  }
  assert.equal(calls.length, 0);
  const value = await call(5, "revert", { workspace: WS, runId: RUN_A, dryRun: true });
  assert.deepEqual(calls, [{ workspace: WS, runId: RUN_A, dryRun: true, unsafeMoveConsent: null }]);
  // A file with an action the contract does not have: the main process refuses the whole list
  // rather than show part of it.
  assert.deepEqual(toRevertView(value), { ok: false, code: "host_error" });
  const real = await call(7, "revert", { workspace: WS, runId: RUN_A, dryRun: false });
  assert.deepEqual(toRevertView(real), {
    ok: true,
    view: {
      runId: RUN_A,
      status: "partial",
      dryRun: false,
      reverted: [
        { path: "<a.txt>", action: "deleted", from: null, unsafe: false },
        { path: "<b.txt>", action: "moved_back", from: "<x/b.txt>", unsafe: true },
      ],
      skipped: [{ path: "<d.txt>", reason: "changed_since_run" }],
      moveSafetyUnchecked: true,
      revertedBefore: null,
    },
  });
  assert.deepEqual(await call(6, "revert", { workspace: WS, runId: RUN_B, dryRun: false }), { ok: false, code: "workspace_locked" });
});

test("history (GU-4): the main process refuses list and revert values that do not fit", () => {
  const run = { state: "checked", runId: RUN_A, kind: "run", startedAt: null, taskId: "t", status: null, reason: null, changes: null, reverted: null, revertRecordDamaged: false };
  assert.equal(toRunsReply({ ok: true, runs: [run], omitted: 0 }).ok, true);
  for (const bad of [{ ...run, kind: "other" }, { ...run, runId: "latest" }, { ...run, startedAt: "yesterday" }, { ...run, reverted: { at: "x", status: "complete" } }, { ...run, status: "Not A Word" }]) {
    assert.deepEqual(toRunsReply({ ok: true, runs: [bad], omitted: 0 }), { ok: false, code: "host_error" });
  }
  const view = { ok: true, runId: RUN_A, status: "complete", dryRun: false, reverted: [], skipped: [], moveSafetyUnchecked: false, revertedBefore: null };
  assert.equal(toRevertView(view).ok, true);
  assert.equal(toRevertView({ ...view, reverted: [{ path: "a", action: "exploded", from: null, unsafe: false }] }).ok, false);
  assert.equal(toRevertView({ ...view, status: "half" }).ok, false);
  assert.deepEqual(parseRunArgs({ workspace: HANDLE, runId: RUN_A }), { workspace: HANDLE, runId: RUN_A });
  assert.equal(parseRunArgs({ workspace: HANDLE, runId: "latest" }), null);
  assert.equal(parseRunArgs({ workspace: HANDLE, runId: RUN_A, dryRun: false }), null);
  assert.equal(parsePreviewArgs({ preview: RUN_A }), null, "a run id is no preview token");
});

test("history (GU-4): a preview is asked only for a listed run; its token works once, for a while, in its workspace", () => {
  let now = 1_000;
  const history = new RunHistory((size) => randomBytes(size), () => now);
  assert.equal(history.wasListed(HANDLE, RUN_A), false);
  history.listedRuns(HANDLE, [RUN_A]);
  assert.equal(history.wasListed(HANDLE, RUN_A), true);
  assert.equal(history.wasListed("2".repeat(32), RUN_A), false, "listed for another workspace");
  const token = history.issuePreview({ workspace: HANDLE, runId: RUN_A, reverted: 1, skipped: 0 });
  assert.match(token, /^[0-9a-f]{32}$/);
  assert.deepEqual(history.takePreview(token), { workspace: HANDLE, runId: RUN_A, reverted: 1, skipped: 0 });
  assert.equal(history.takePreview(token), null, "a token works once");
  const late = history.issuePreview({ workspace: HANDLE, runId: RUN_A, reverted: 1, skipped: 0 });
  now += PREVIEW_TTL_MS + 1;
  assert.equal(history.takePreview(late), null, "a token stops working after a while");
  const forgotten = history.issuePreview({ workspace: HANDLE, runId: RUN_A, reverted: 1, skipped: 0 });
  history.forget(HANDLE);
  assert.equal(history.takePreview(forgotten), null);
  assert.equal(history.wasListed(HANDLE, RUN_A), false);
  const first = history.issuePreview({ workspace: HANDLE, runId: RUN_A, reverted: 0, skipped: 0 });
  for (let i = 0; i < 16; i += 1) history.issuePreview({ workspace: HANDLE, runId: RUN_A, reverted: 0, skipped: 0 });
  assert.equal(history.takePreview(first), null, "the oldest tokens go past the limit");
});

test("history (DR-25): a consent to unsafe moves reaches the app only with a real revert, naming that run", async () => {
  const calls: unknown[] = [];
  const call = host({
    revert: async (request) => {
      calls.push(request);
      return { ok: true, output: { kind: "revert", runId: RUN_A, status: "complete", exitCode: 0, reverted: [], skipped: [] } };
    },
  });
  assert.equal(await call(1, "revert", { workspace: WS, runId: RUN_A, dryRun: true, consent: true }), "invalid_args", "a dry run takes no consent");
  assert.equal(await call(2, "revert", { workspace: WS, runId: RUN_A, dryRun: false, consent: "yes" }), "invalid_args");
  assert.equal(await call(3, "revert", { workspace: WS, runId: RUN_A, dryRun: false, unsafeMoveConsent: { runId: RUN_B } }), "invalid_args", "the window cannot name a consent");
  assert.equal(calls.length, 0);
  await call(4, "revert", { workspace: WS, runId: RUN_A, dryRun: false });
  await call(5, "revert", { workspace: WS, runId: RUN_A, dryRun: false, consent: true });
  assert.deepEqual(calls, [
    { workspace: WS, runId: RUN_A, dryRun: false, unsafeMoveConsent: null },
    { workspace: WS, runId: RUN_A, dryRun: false, unsafeMoveConsent: { runId: RUN_A } },
  ]);
});

test("history (DR-25): a retry token comes from a revert's result, works once, for a while, in its workspace", () => {
  let now = 0;
  const history = new RunHistory((size) => randomBytes(size), () => now);
  const token = history.issueConsentRetry({ workspace: HANDLE, runId: RUN_A, files: 2 });
  assert.deepEqual(parseRetryArgs({ retry: token }), { retry: token });
  assert.equal(parseRetryArgs({ retry: token, consent: true }), null);
  assert.equal(parseRetryArgs({ retry: RUN_A }), null, "a run id is no retry token");
  assert.equal(history.takePreview(token), null, "a retry token is no preview token");
  const again = history.issueConsentRetry({ workspace: HANDLE, runId: RUN_A, files: 2 });
  assert.deepEqual(history.takeConsentRetry(again), { workspace: HANDLE, runId: RUN_A, files: 2 });
  assert.equal(history.takeConsentRetry(again), null, "once");
  const late = history.issueConsentRetry({ workspace: HANDLE, runId: RUN_A, files: 1 });
  now += PREVIEW_TTL_MS + 1;
  assert.equal(history.takeConsentRetry(late), null, "for a while");
  const closed = history.issueConsentRetry({ workspace: HANDLE, runId: RUN_A, files: 1 });
  history.forget(HANDLE);
  assert.equal(history.takeConsentRetry(closed), null, "the workspace closing forgets it");
});
