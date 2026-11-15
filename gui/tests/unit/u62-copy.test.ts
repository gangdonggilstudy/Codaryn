/**
 * U-62 (docs/design/standalone-gui.md 6.4, 2 principle 4; 3.7, 3.8, 3.9; review R-73 M1, L1): copying.
 * The page never writes the clipboard; it asks the main process, which copies only the two things
 * the window copies: a run id (the result, the run list, the report) and a digest's first 12
 * characters (the plan). Anything else is refused, so the page cannot put other text on the
 * clipboard. A path is not copied through copyText (PM, after R-73 M1); since the tree is the app
 * layer's workspace list (U-103, G-list) a tree entry's path has its own call, copyPath, by the entry's id.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { copyControl } from "../../src/renderer/shell/copy.js";
import { IPC_CHANNELS, copyableValue, parseCopyArgs } from "../../src/shared/ipc.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const RUN = "20261113T060000Z-0000a062";
const DIGEST = "0123456789abcdef".padEnd(64, "e");

test("U-62: the main process copies a run id or a digest's first 12 characters, nothing else", () => {
  assert.equal(copyableValue(RUN), RUN);
  assert.equal(copyableValue(DIGEST.slice(0, 12)), DIGEST.slice(0, 12));
  const refused = ["", "sub/b.txt", "C:\\work\\notes.md", "a note", DIGEST, DIGEST.slice(0, 11), DIGEST.slice(0, 13), "0123456789AB", "latest", `${RUN} `, `${RUN}\n`, "20261113T060000Z-0000A062", "sk-ant-not-a-key"];
  for (const text of refused) assert.equal(copyableValue(text), null, JSON.stringify(text));
  assert.equal(copyableValue(12), null);
  assert.equal(parseCopyArgs({ text: RUN }), RUN);
  assert.equal(parseCopyArgs({ text: RUN, path: "C:/x" }), null, "nothing else rides along");
  assert.equal(parseCopyArgs(RUN), null);
  assert.equal(IPC_CHANNELS.copyPath, "codaryn:workspace:copypath", "U-103: a path only through its own call, by an entry's id");
});

test("U-62: a copy button asks the main process and says what came of it", async () => {
  const restore = installFakeDom();
  try {
    const asked: string[] = [];
    const replies: unknown[] = [{ ok: true }, { ok: false, code: "invalid_args" }];
    const box = copyControl(textsFor("en"), "Copy run id", async () => {
      asked.push("copy");
      return replies.shift();
    }, { id: "x-copy" }) as unknown as FakeElement;
    const control = box.findAll((e) => e.getAttribute("id") === "x-copy")[0];
    const status = box.findAll((e) => e.getAttribute("role") === "status")[0];
    control?.click();
    await settle();
    assert.equal(status?.getAttribute("data-copied"), "ok");
    assert.equal(status?.textContent, "Copied.");
    control?.click();
    await settle();
    assert.equal(status?.getAttribute("data-copied"), "invalid_args");
    assert.deepEqual(asked, ["copy", "copy"]);
  } finally {
    restore();
  }
});

test("U-62: the run list copies the run id and the plan the digest's first 12", async () => {
  const restore = installFakeDom();
  try {
    const copied: string[] = [];
    const api = new Proxy({} as CodarynApi, {
      get: (_t, name: string) => async (...args: unknown[]) => {
        if (name === "copyText") {
          copied.push(String(args[0]));
          return { ok: true };
        }
        if (name === "listRuns") return { ok: true, runs: [{ state: "checked", runId: RUN, kind: "run", startedAt: null, taskId: "t", status: "done", reason: "verified", changes: 0, reverted: null, revertRecordDamaged: false }], omitted: 0 };
        if (name === "plan") return { ok: true, view: { runId: RUN, status: "pending", digest: DIGEST, actions: [{ kind: "move", from: "a", to: "b" }], inventoryLimitReached: false, appliedBy: null }, approval: null };
        return null;
      },
    });
    const { runsScreen } = await import("../../src/renderer/runs/runs-screen.js");
    const { planScreen } = await import("../../src/renderer/plan/plan-screen.js");
    const { RunModel } = await import("../../src/renderer/run/run-model.js");
    const workspace = { handle: "1".repeat(32), name: "ws" };
    const runs = runsScreen({ texts: textsFor("en"), api, current: () => workspace, open: () => undefined, announce: () => undefined, openPlan: () => undefined, openChanges: () => undefined, openReport: () => undefined });
    const runsRoot = new FakeElement("main");
    runs.show(runsRoot as unknown as HTMLElement);
    await settle();
    runsRoot.findAll((e) => e.getAttribute("data-copy") === RUN)[0]?.click();
    await settle();
    const plan = planScreen({ texts: textsFor("en"), api, run: new RunModel(), current: () => workspace, showRun: () => undefined });
    plan.choose(RUN, null, null);
    const planRoot = new FakeElement("main");
    plan.show(planRoot as unknown as HTMLElement);
    await settle();
    planRoot.findAll((e) => e.getAttribute("id") === "plan-copy-digest")[0]?.click();
    await settle();
    assert.deepEqual(copied, [RUN, DIGEST.slice(0, 12)]);
    assert.ok(copied.every((value) => copyableValue(value) !== null), "each is what the main process takes");
  } finally {
    restore();
  }
});
