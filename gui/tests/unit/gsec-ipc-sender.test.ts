/**
 * G-sec (U-274; standalone-gui 6.4, GS-2): every IPC channel answers only the app window's main frame
 * on the app's own origin. The main process's real handlers (registerIpc) run with an `electron`
 * stand-in (gsec-ipc-harness.ts). For each channel and each foreign sender - another web contents, a
 * frame inside the window, the main frame on another or a look-alike origin, a frame already gone,
 * no window, a destroyed window - the handler answers nothing, and nothing reaches the engine host,
 * an OS dialog or question, the clipboard, the file manager or the window. The window's own main
 * frame is answered (the harness is wired). Written by a session that did not implement the GUI.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CHANNELS, FOREIGN_EVENTS, IPC_CHANNELS, createIpc, registeredChannels } from "./gsec-ipc-harness.js";

describe("G-sec: the IPC handlers' sender check", () => {
  test("every channel of the shared list is registered, through ipcMain.handle only, and nothing else is", async () => {
    await createIpc();
    assert.deepEqual(registeredChannels(), [...CHANNELS].sort());
  });

  test("the app window's main frame is answered (the harness reaches the handlers)", async () => {
    const ipc = await createIpc();
    ipc.answer = (call) => (call === "messages" ? { v: 1, id: 0, ok: true, value: { language: "en", texts: {} } } : { v: 1, id: 0, ok: false, error: { code: "x", message: "x" } });
    const reply = (await ipc.call(IPC_CHANNELS.info, [])) as { engine?: string } | null;
    assert.equal(reply?.engine, "ready", JSON.stringify(reply));
    assert.deepEqual(ipc.hostCalls.map((item) => item.call), ["messages"]);
  });

  for (const { why, event } of FOREIGN_EVENTS) {
    test(`a call from ${why}: no channel answers, nothing is done`, async () => {
      const ipc = await createIpc();
      const { handle } = await ipc.openWorkspace();
      for (const channel of CHANNELS) {
        // Arguments a window could give: a workspace handle, as most channels take one.
        for (const args of [[], [{ workspace: handle }]]) {
          const reply = await ipc.call(channel, args, event);
          assert.equal(reply, null, `${channel} answered ${why}: ${JSON.stringify(reply)}`);
        }
      }
      assert.deepEqual([ipc.hostCalls, ipc.effects, ipc.sent], [[], [], []]);
    });
  }

  for (const windowState of ["none", "destroyed"] as const) {
    test(`with ${windowState === "none" ? "no window" : "a destroyed window"}: no channel answers, nothing is done`, async () => {
      const ipc = await createIpc();
      const { handle } = await ipc.openWorkspace();
      ipc.windowState = windowState;
      for (const channel of CHANNELS) {
        const reply = await ipc.call(channel, [{ workspace: handle }]);
        assert.equal(reply, null, `${channel}: ${JSON.stringify(reply)}`);
      }
      assert.deepEqual([ipc.hostCalls, ipc.effects, ipc.sent], [[], [], []]);
    });
  }
});
