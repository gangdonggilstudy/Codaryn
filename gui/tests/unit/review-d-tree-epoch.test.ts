/** Review D: settings invalidation also rejects tree/change replies already under way. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { test } from "node:test";
import type { HostCall, HostResponse } from "../../src/shared/protocol.js";
import type { ChangesReply, TreeReply } from "../../src/shared/ipc.js";
import { IPC_CHANNELS, createIpc } from "./gsec-ipc-harness.js";
import type { Ipc } from "./gsec-ipc-harness.js";

const RUN = "20261127T010203Z-00000001";
const OLD_NAME = "SYNTHETIC_OLD_RULE.txt";
const ok = (value: unknown): HostResponse => ({ v: 1, id: 0, ok: true, value });
const treeValue = () => ({ ok: true, entries: [{ name: OLD_NAME, shown: OLD_NAME, kind: "file", masked: false, protected: false }], total: 1, offset: 0, nextOffset: null });
const changesValue = () => ({ ok: true, runId: RUN, masking: "current_secrets", files: [{ path: OLD_NAME, created: false, state: "as_run_left", unavailable: null, before: "old", after: "old" }] });
const request = (kind: "tree" | "changes", handle: string): unknown[] => [kind === "tree"
  ? { workspace: handle, node: null, offset: 0 }
  : { workspace: handle, runId: RUN, profile: null, workflow: null }];
const response = (kind: "tree" | "changes"): HostResponse => ok(kind === "tree" ? treeValue() : changesValue());

/** The actual applySettings handler consumes the proposal and runs dropTreeIds when written. */
async function settings(ipc: Ipc, written = true): Promise<void> {
  const token = ipc.deps.settingsProposals.issue({ next: { secretEnv: ["SYNTHETIC_SOURCE"] }, baseDigest: "a".repeat(64), changes: [], widening: [] });
  ipc.answer = call => call === "applySettings" ? ok({ ok: true, written, changes: [], widening: [] }) : response(call === "tree" ? "tree" : "changes");
  assert.deepEqual(await ipc.call(IPC_CHANNELS.applySettings, [{ token }]), { ok: true, written, changes: [], widening: [] });
}

for (const kind of ["tree", "changes"] as const) {
  for (const phase of ["host", "response"] as const) {
    test(`review D epoch: ${kind} begun before a settings write is refused after ${phase} wait`, { timeout: 10_000 }, async t => {
      const ipc = await createIpc(), workspace = await ipc.openWorkspace();
      await fs.writeFile(path.join(workspace.root, OLD_NAME), "synthetic contents");
      const oldId = ipc.deps.workspaces.treeIds.issue(workspace.handle, OLD_NAME);
      const oldEdit = ipc.deps.textEdits.issue(workspace.handle, OLD_NAME, "b".repeat(64));
      const available = await ipc.deps.host();
      assert.ok("host" in available);
      const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
      t.after(() => release.resolve());
      let first = true;
      const host = { ...available.host, async call(call: HostCall, args: unknown, timeout: number): Promise<HostResponse> {
        if (phase === "response" && call === kind && first) {
          first = false;
          ipc.hostCalls.push({ call, args });
          entered.resolve();
          await release.promise;
          return response(kind);
        }
        return available.host.call(call, args, timeout);
      } };
      Object.assign(ipc.deps, { host: async () => {
        if (phase === "host" && first) { first = false; entered.resolve(); await release.promise; }
        return { host };
      } });
      ipc.answer = call => response(call === "tree" ? "tree" : "changes");
      const pending = ipc.call(IPC_CHANNELS[kind], request(kind, workspace.handle));
      await entered.promise;
      await settings(ipc);
      assert.equal(ipc.deps.workspaces.treeIds.resolve(workspace.handle, oldId), null);
      assert.equal(ipc.deps.textEdits.get(oldEdit), null);
      release.resolve();
      const reply = await pending as TreeReply | ChangesReply;
      const id = reply.ok ? ("entries" in reply ? reply.entries[0]?.id : reply.files[0]?.id) : null;
      const copied = id ? await ipc.call(IPC_CHANNELS.copyPath, [{ workspace: workspace.handle, node: id }]) : null;
      t.diagnostic(JSON.stringify({ kind, phase, staleAccepted: reply.ok, reissuedIds: ipc.deps.workspaces.treeIds.size, copied }));
      assert.deepEqual(reply, { ok: false, code: "unknown_entry" });
      assert.equal(ipc.deps.workspaces.treeIds.size, 0, "a stale reply must not recreate ids after clear");
    });
  }
}

test("review D epoch: a settings write during changes disk checks issues no ids", { timeout: 10_000 }, async t => {
  const ipc = await createIpc(), workspace = await ipc.openWorkspace();
  const target = path.join(workspace.root, OLD_NAME);
  await fs.writeFile(target, "synthetic contents");
  ipc.answer = () => response("changes");
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const actual = fs.lstat;
  const mock = t.mock.method(fs, "lstat", async (...args: unknown[]) => {
    const info = await Reflect.apply(actual, fs, args);
    if (args[0] === target) { entered.resolve(); await release.promise; }
    return info;
  });
  syncBuiltinESMExports();
  t.after(() => { release.resolve(); mock.mock.restore(); syncBuiltinESMExports(); });
  const pending = ipc.call(IPC_CHANNELS.changes, request("changes", workspace.handle));
  await entered.promise;
  await settings(ipc);
  release.resolve();
  const reply = await pending as ChangesReply;
  t.diagnostic(JSON.stringify({ phase: "disk", staleAccepted: reply.ok, reissuedIds: ipc.deps.workspaces.treeIds.size }));
  assert.deepEqual(reply, { ok: false, code: "unknown_entry" });
  assert.equal(ipc.deps.workspaces.treeIds.size, 0);
});

for (const written of [false, true]) {
  test(`review D epoch: written=${written} keeps ordinary fresh tree/changes requests working`, async () => {
    const ipc = await createIpc(), workspace = await ipc.openWorkspace();
    await fs.writeFile(path.join(workspace.root, OLD_NAME), "synthetic contents");
    const oldId = ipc.deps.workspaces.treeIds.issue(workspace.handle, OLD_NAME);
    await settings(ipc, written);
    assert.equal(ipc.deps.workspaces.treeIds.resolve(workspace.handle, oldId), written ? null : OLD_NAME);
    const tree = await ipc.call(IPC_CHANNELS.tree, request("tree", workspace.handle)) as TreeReply;
    const changes = await ipc.call(IPC_CHANNELS.changes, request("changes", workspace.handle)) as ChangesReply;
    assert.ok(tree.ok && changes.ok);
    for (const id of [tree.entries[0]?.id, changes.files[0]?.id]) {
      assert.ok(typeof id === "string");
      assert.equal(ipc.deps.workspaces.treeIds.resolve(workspace.handle, id), OLD_NAME);
    }
  });
}
