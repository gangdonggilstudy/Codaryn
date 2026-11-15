import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { createHostHandler } from "../../src/engine-host/host.js";
import type { HostMessage } from "../../src/shared/protocol.js";
import { fakeApp } from "./fake-app.js";
import { createIpc, IPC_CHANNELS } from "./gsec-ipc-harness.js";

const RUN = "20261115T010203Z-0000abcd", WS = path.resolve("synthetic-report-workspace");

test("DR-77 save: each save forwards the current window language, not renderer-supplied language", async () => {
  const ipc = await createIpc(), workspace = await ipc.openWorkspace();
  let language: "ko" | "en" = "ko";
  ipc.answer = (call) => call === "messages"
    ? { v: 1, id: 0, ok: true, value: { language, texts: {} } }
    : { v: 1, id: 0, ok: true, value: { ok: true, text: "# report\n" } };
  for (const chosen of ["ko", "en"] as const) {
    language = chosen;
    await ipc.call(IPC_CHANNELS.info, []);
    assert.deepEqual(await ipc.call(IPC_CHANNELS.saveReport, [{ workspace: workspace.handle, runId: RUN }]), { ok: false, code: "not_saved" });
    assert.deepEqual(ipc.hostCalls.at(-1), { call: "reportMarkdown", args: { workspace: workspace.root, runId: RUN, language: chosen } });
  }
  const count = ipc.hostCalls.length;
  assert.deepEqual(await ipc.call(IPC_CHANNELS.saveReport, [{ workspace: workspace.handle, runId: RUN, language: "ko" }]), { ok: false, code: "invalid_args" });
  assert.equal(ipc.hostCalls.length, count);
});

test("DR-77 host: absent language is English, en/ko pass; every other explicit value is invalid_args", async () => {
  const requests: unknown[] = [], written: HostMessage[] = [];
  const handler = createHostHandler({
    app: fakeApp({ reportMarkdown: async request => { requests.push(request); return { ok: true, output: { kind: "report_markdown", markdown: "# report\n", exitCode: 0 } }; } }),
    messages: { texts: () => ({ language: "en", texts: {} }) }, tree: async () => null,
    shown: s => s, shownText: s => s, providers: [], itemsIn: () => () => null, token: () => "0".repeat(32),
    write: line => written.push(JSON.parse(line) as HostMessage), log: () => undefined,
  });
  let id = 0;
  async function call(args: unknown) { const next = ++id; await handler.handleLine(JSON.stringify({ v: 1, id: next, call: "reportMarkdown", args })); return written.at(-1) as { ok: boolean; error?: { code: string } }; }
  for (const extra of [{}, { language: "en" }, { language: "ko" }]) assert.equal((await call({ workspace: WS, runId: RUN, ...extra })).ok, true);
  assert.deepEqual(requests, [
    { workspace: WS, runId: RUN, language: "en" }, { workspace: WS, runId: RUN, language: "en" }, { workspace: WS, runId: RUN, language: "ko" },
  ]);
  for (const language of [null, "EN", "fr", "", 1, false, [], {}]) {
    const result = await call({ workspace: WS, runId: RUN, language });
    assert.equal(result.ok, false); assert.equal(result.error?.code, "invalid_args");
  }
  assert.equal(requests.length, 3, "invalid language never calls the app");
});
