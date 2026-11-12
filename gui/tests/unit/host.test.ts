/** GU-1: the engine host's request handling (src/engine-host/host.ts) with a fake app, without Electron. */

import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { createHostHandler, serve } from "../../src/engine-host/host.js";
import type { HostApp, HostDeps, HostDoctorRequest, HostMessages } from "../../src/engine-host/host.js";
import { encodeLine, parseHostMessage } from "../../src/shared/protocol.js";
import type { HostMessage } from "../../src/shared/protocol.js";

const ABSOLUTE = path.resolve("workspace-for-test");
const DOCTOR_OUTPUT = { ok: true, output: { schemaVersion: 1, kind: "doctor", status: "ok", exitCode: 0, checks: [] } };

function harness(app: Partial<HostApp> = {}, messages?: HostMessages) {
  const written: HostMessage[] = [];
  const logs: string[] = [];
  const requests: HostDoctorRequest[] = [];
  const deps: HostDeps = {
    app: {
      doctor: async (request) => {
        requests.push(request);
        return DOCTOR_OUTPUT;
      },
      readSettings: async () => ({ ok: false, error: { code: "invalid_config", message: "not used" } }),
      listModels: async () => ({ ok: false, error: { code: "missing_api_key", message: "not used" } }),
      selectModel: async () => ({ ok: false, error: { code: "missing_api_key", message: "not used" } }),
      ...app,
    },
    // Marks every text that passed the host's cleaning, so a test sees which ones did.
    shown: (text) => `<${text.replace(/[\u0000-\u001f]/g, "?")}>`,
    providers: ["anthropic"],
    messages: messages ?? { texts: (_locale, ids) => ({ language: "en", texts: Object.fromEntries(ids.map((id) => [id, `T:${id}`])) }) },
    tree: async (request) => ({ ok: true, entries: [], total: 0, offset: request.offset, nextOffset: null, dir: request.dir }),
    write: (line) => {
      assert.ok(line.endsWith("\n"));
      const message = parseHostMessage(line.trimEnd());
      assert.notEqual(message, null, "every written line is a valid message");
      written.push(message as HostMessage);
    },
    log: (text) => logs.push(text),
  };
  return { deps, handler: createHostHandler(deps), written, logs, requests };
}

const line = (id: number, call: string, args: unknown): string => JSON.stringify({ v: 1, id, call, args });

test("host: doctor passes an absolute workspace or null to the app and returns its outcome as is", async () => {
  const { handler, written, requests } = harness();
  await handler.handleLine(line(1, "doctor", { workspace: null }));
  await handler.handleLine(line(2, "doctor", { workspace: ABSOLUTE }));
  assert.deepEqual(requests, [
    { configPath: null, varsFile: null, taskPath: null, workspace: null },
    { configPath: null, varsFile: null, taskPath: null, workspace: ABSOLUTE },
  ]);
  assert.deepEqual(written, [
    { v: 1, id: 1, ok: true, value: DOCTOR_OUTPUT },
    { v: 1, id: 2, ok: true, value: DOCTOR_OUTPUT },
  ]);
});

test("host: arguments that do not fit are refused before the app is called", async () => {
  const { handler, written, requests } = harness();
  const cases: unknown[] = [
    { workspace: "relative/dir" },
    { workspace: `${ABSOLUTE}\u0000x` },
    { workspace: 5 },
    { workspace: null, configPath: "/etc/x" },
    "text",
    [ABSOLUTE],
  ];
  for (const [index, args] of cases.entries()) await handler.handleLine(line(index + 1, "doctor", args));
  assert.equal(requests.length, 0);
  assert.deepEqual(
    written.map((message) => ("ok" in message && !message.ok ? message.error.code : "?")),
    cases.map(() => "invalid_args"),
  );
});

test("host: an unknown call is answered with its id; a line without an id is only logged", async () => {
  const { handler, written, logs } = harness();
  await handler.handleLine(line(9, "startRun", {}));
  await handler.handleLine("not json at all");
  assert.deepEqual(written, [{ v: 1, id: 9, ok: false, error: { code: "unknown_call", message: "unknown call" } }]);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0] as string, /not json/, "the line itself is not logged");
});

test("host: an exception in the app becomes host_error without its text, and the host goes on", async () => {
  const secretPath = path.resolve("fake-secret-path-0001");
  const { handler, written, logs } = harness({
    doctor: async () => {
      throw new Error(`failed at ${secretPath}`);
    },
  });
  await handler.handleLine(line(1, "doctor", { workspace: null }));
  assert.deepEqual(written, [{ v: 1, id: 1, ok: false, error: { code: "host_error", message: "the engine host failed on this call" } }]);
  assert.doesNotMatch(JSON.stringify({ written, logs }), /fake-secret-path-0001/);
});

test("host: messages checks the locale and the ids and returns the catalog's answer", async () => {
  const { handler, written } = harness();
  await handler.handleLine(line(1, "messages", { osLocale: "ko-KR", ids: ["doctor.status.ok"] }));
  await handler.handleLine(line(2, "messages", { osLocale: null, ids: [] }));
  await handler.handleLine(line(3, "messages", { osLocale: "ko KR", ids: [] }));
  await handler.handleLine(line(4, "messages", { osLocale: null, ids: ["Doctor.Status"] }));
  await handler.handleLine(line(5, "messages", { osLocale: null, ids: Array.from({ length: 201 }, () => "a") }));
  assert.deepEqual(written.slice(0, 2), [
    { v: 1, id: 1, ok: true, value: { language: "en", texts: { "doctor.status.ok": "T:doctor.status.ok" } } },
    { v: 1, id: 2, ok: true, value: { language: "en", texts: {} } },
  ]);
  assert.deepEqual(
    written.slice(2).map((message) => ("ok" in message && !message.ok ? message.error.code : "?")),
    ["invalid_args", "invalid_args", "invalid_args"],
  );
});

test("host: serve answers every line of a stream, also split across chunks and out of order", async () => {
  let release: (() => void) | null = null;
  const slow = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { deps, written } = harness({
    doctor: async (request) => {
      if (request.workspace === null) await slow;
      return { ok: true, output: request.workspace };
    },
  });
  async function* input(): AsyncGenerator<string | Uint8Array> {
    const all = `${line(1, "doctor", { workspace: null })}\n${line(2, "doctor", { workspace: ABSOLUTE })}\n`;
    yield all.slice(0, 10);
    yield new TextEncoder().encode(all.slice(10));
    // The first call answers only after the second; serve must wait for both.
    setTimeout(() => release?.(), 20);
  }
  await serve(input(), deps);
  assert.deepEqual(
    written.map((message) => ("id" in message ? message.id : 0)),
    [2, 1],
  );
});

test("host: a request line longer than the limit is skipped and logged", async () => {
  const { deps, written, logs } = harness();
  async function* input(): AsyncGenerator<string> {
    yield `${"x".repeat(9 * 1024 * 1024)}\n`;
    yield encodeLine({ v: 1, id: 2, call: "doctor", args: { workspace: null } });
  }
  await serve(input(), deps);
  assert.equal(written.length, 1);
  assert.match(logs.join("\n"), /longer than the limit/);
});

test("host (R-10 L-2): when the input ends, serve waits at most the grace time for running calls and says so once", async () => {
  let ended = 0;
  const { deps } = harness({
    doctor: () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, output: "late" }), 3_000)),
  });
  async function* input(): AsyncGenerator<string> {
    yield encodeLine({ v: 1, id: 1, call: "doctor", args: { workspace: null } });
  }
  const begin = Date.now();
  await serve(input(), { ...deps, onInputEnd: () => (ended += 1) }, { graceMs: 200 });
  const took = Date.now() - begin;
  assert.ok(took < 1_500, `serve ended after ${took} ms, not after the 3 s call`);
  assert.equal(ended, 1);
});
