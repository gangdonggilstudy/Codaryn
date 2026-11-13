/**
 * G-sec (U-274; standalone-gui 6.4): every IPC channel checks its arguments before it does anything.
 * The main process's real handlers (registerIpc) run with an `electron` stand-in
 * (gsec-ipc-harness.ts) and are called from the app window's own main frame, the one sender they
 * answer, with arguments no window of the app sends: a second argument, a number, a string, an
 * array, null, an object with a field no channel takes, an object whose own `__proto__` key tries to
 * reach Object.prototype, a 1 MB string, a path where a workspace handle goes, and a handle the main
 * process never issued. Each is refused (nothing, false, or ok: false), and nothing reaches the engine
 * host, an OS dialog or question, the clipboard, the file manager or the window; Object.prototype is
 * untouched. Written by a session that did not implement the GUI.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CHANNELS, createIpc, refused } from "./gsec-ipc-harness.js";

/** A handle-shaped value the main process never issued. */
const NEVER_ISSUED = "0123456789abcdef0123456789abcdef";

const MALFORMED: readonly { readonly what: string; readonly args: readonly unknown[] }[] = [
  { what: "two arguments", args: [{}, {}] },
  { what: "a number", args: [42] },
  { what: "a string", args: ["gsec"] },
  { what: "an array", args: [[]] },
  { what: "null", args: [null] },
  { what: "a field no channel takes", args: [{ gsecUnknownField: 1 }] },
  { what: "an own __proto__ key", args: [JSON.parse('{"__proto__":{"gsecPolluted":true},"workspace":"0123456789abcdef0123456789abcdef"}')] },
  { what: "a 1 MB string", args: [{ workspace: "a".repeat(1_000_000) }] },
  { what: "a path where a handle goes", args: [{ workspace: process.platform === "win32" ? "C:\\Windows" : "/etc" }] },
];

describe("G-sec: the IPC handlers' argument checks", () => {
  for (const { what, args } of MALFORMED) {
    test(`${what}: every channel refuses it, nothing is done`, async () => {
      const ipc = await createIpc();
      for (const channel of CHANNELS) {
        const reply = await ipc.call(channel, args);
        assert.ok(refused(reply), `${channel} took ${what}: ${JSON.stringify(reply)?.slice(0, 200)}`);
      }
      assert.deepEqual(ipc.hostCalls, [], "no engine host call");
      assert.deepEqual(ipc.effects, [], "no dialog, question, clipboard, file manager or restart");
      assert.deepEqual(ipc.sent, [], "nothing sent to the window");
      assert.equal(({} as { gsecPolluted?: unknown }).gsecPolluted, undefined, "Object.prototype is untouched");
    });
  }

  test("a workspace handle the main process never issued: every channel that names one refuses, nothing is done", async () => {
    const ipc = await createIpc();
    for (const channel of CHANNELS) {
      const reply = await ipc.call(channel, [{ workspace: NEVER_ISSUED }]);
      assert.ok(refused(reply), `${channel}: ${JSON.stringify(reply)?.slice(0, 200)}`);
    }
    assert.deepEqual([ipc.hostCalls, ipc.effects, ipc.sent], [[], [], []]);
  });
});
