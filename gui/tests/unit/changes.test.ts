/**
 * DR-29: the changes view gives paths and states only. The engine host's call with a fake app
 * (src/engine-host/plans.ts) and the main process's check (src/shared/ipc.ts).
 */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { createHostHandler } from "../../src/engine-host/host.js";
import { toChangesReply } from "../../src/shared/ipc.js";
import { parseHostMessage } from "../../src/shared/protocol.js";
import type { HostMessage } from "../../src/shared/protocol.js";
import { fakeApp } from "./fake-app.js";

const WS = path.resolve("ws-for-changes");
const RUN = "20261112T010203Z-0000abcd";
const SECRET = "fake-secret-in-a-file-0001";

test("changes (DR-29): the host keeps the files' text and passes paths and states only", async () => {
  const calls: unknown[] = [];
  const written: HostMessage[] = [];
  const handler = createHostHandler({
    app: fakeApp({
      changes: async (request) => {
        calls.push(request);
        return {
          ok: true,
          output: {
            schemaVersion: 1,
            kind: "changes",
            runId: RUN,
            exitCode: 0,
            masking: "current_secrets",
            files: [
              { path: "a.md", created: false, state: "as_run_left", before: `old ${SECRET}`, after: `new ${SECRET}`, unavailable: null },
              { path: "b.md", created: true, state: "missing", before: null, after: null, unavailable: null },
              { path: "c.bin", created: false, state: "exploded", before: null, after: null, unavailable: "not_text" },
            ],
          },
        };
      },
    }),
    messages: { texts: () => ({ language: "en", texts: {} }) },
    tree: async () => null,
    shown: (text) => `<${text}>`,
    providers: [],
    itemsIn: () => () => null,
    token: () => "0".repeat(32),
    write: (line) => written.push(parseHostMessage(line.trimEnd()) as HostMessage),
    log: () => undefined,
  });
  const call = async (id: number, args: unknown): Promise<unknown> => {
    await handler.handleLine(JSON.stringify({ v: 1, id, call: "changes", args }));
    const message = written.find((m) => "id" in m && m.id === id) as { ok: boolean; value?: unknown; error?: { code: string } };
    return message.ok ? message.value : message.error?.code;
  };
  assert.equal(await call(1, { workspace: WS, profile: null, runId: "latest" }), "invalid_args");
  const value = await call(2, { workspace: WS, profile: "doc", runId: RUN });
  assert.deepEqual(calls, [{ settings: { input: { kind: "workspace", workspace: WS }, configPath: null, varsFile: null, profile: "doc" }, runId: RUN }]);
  assert.equal(JSON.stringify(value).includes(SECRET), false, "no file text leaves the host");
  assert.deepEqual(toChangesReply(value), {
    ok: true,
    runId: RUN,
    files: [
      { path: "<a.md>", created: false, state: "as_run_left", unavailable: null },
      { path: "<b.md>", created: true, state: "missing", unavailable: null },
      { path: "<c.bin>", created: false, state: "unknown", unavailable: "not_text" },
    ],
  });
});

test("changes (DR-29): the main process refuses a changes value that carries text or another masking", () => {
  const file = { path: "a.md", created: false, state: "as_run_left", unavailable: null };
  const good = { ok: true, runId: RUN, masking: "current_secrets", files: [file] };
  assert.equal(toChangesReply(good).ok, true);
  assert.deepEqual(toChangesReply({ ...good, files: [{ ...file, after: "text" }] }), { ok: false, code: "host_error" });
  assert.deepEqual(toChangesReply({ ...good, masking: "run_table" }), { ok: false, code: "host_error" });
  assert.deepEqual(toChangesReply({ ...good, files: [{ ...file, state: "gone" }] }), { ok: false, code: "host_error" });
  assert.deepEqual(toChangesReply({ ok: false, code: "invalid_config" }), { ok: false, code: "invalid_config" });
});
