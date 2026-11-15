/**
 * U-66 (docs/design/standalone-gui.md 3.4): the comparison drawn side by side (before | now) or in
 * one column, long lines wrapped or not, and "show in folder" from the comparison. The page sends
 * only the main process's id for a file; the main process gives one only for a plain path that is
 * there (not missing, not behind a masked path, outside the state directory).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { changesScreen } from "../../src/renderer/changes/changes-screen.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { lineDiff } from "../../src/renderer/diff/line-diff.js";
import { sideBySide } from "../../src/renderer/diff/side-by-side.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { revealableChange } from "../../src/shared/ipc.js";
import type { ChangedFileItem } from "../../src/shared/ipc.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const RUN_ID = "20261113T090000Z-0000a066";
const HANDLE = "0123456789abcdef0123456789abcdef";

test("U-66: side by side keeps unchanged lines on both sides and pairs each run of changes in order", () => {
  const lines = lineDiff("a\nb\nc\nd\ne\n", "a\nB\nC\nX\nd\ne\nf\n");
  const rows = sideBySide(lines).map((row) => [row.left?.text ?? "", row.right?.text ?? "", row.hunk]);
  assert.deepEqual(rows, [
    ["a", "a", false],
    ["b", "B", true],
    ["c", "C", false],
    ["", "X", false],
    ["d", "d", false],
    ["e", "e", false],
    ["", "f", true],
  ]);
  const numbers = sideBySide(lines).map((row) => [row.left?.oldNo ?? null, row.right?.newNo ?? null]);
  assert.deepEqual(numbers[3], [null, 4], "the longer side's rest stands against an empty cell");
  assert.deepEqual(sideBySide(lineDiff(null, "x\ny\n")).map((row) => [row.left, row.right?.text, row.hunk]), [
    [null, "x", true],
    [null, "y", false],
  ]);
  assert.deepEqual(sideBySide(lineDiff("x\n", null)).map((row) => [row.left?.text, row.right]), [["x", null]]);
  assert.deepEqual(sideBySide([]), []);
  const interleaved = sideBySide([
    { kind: "removed", oldNo: 1, newNo: null, text: "r1" },
    { kind: "added", oldNo: null, newNo: 1, text: "a1" },
    { kind: "removed", oldNo: 2, newNo: null, text: "r2" },
  ]);
  assert.deepEqual(interleaved.map((row) => [row.left?.text ?? "", row.right?.text ?? ""]), [
    ["r1", "a1"],
    ["r2", ""],
  ]);
});

const file = (path: string, extra: Partial<ChangedFileItem> = {}): ChangedFileItem => ({ path, created: false, state: "as_run_left", unavailable: null, before: "one\ntwo\n", after: "one\nTWO\n", ...extra });

test("U-66: only a plain path that is there gets an id for show in folder", () => {
  assert.equal(revealableChange(file("notes.md")), true);
  assert.equal(revealableChange(file("docs/회의록.md")), true);
  assert.equal(revealableChange(file("gone.md", { state: "missing" })), false);
  assert.equal(revealableChange(file("[key].md", { unavailable: "masked_path" })), false);
  assert.equal(revealableChange(file(".codaryn/runs/x.json")), false);
  assert.equal(revealableChange(file(".CODARYN/x")), false);
  assert.equal(revealableChange(file("../outside.md")), false);
  assert.equal(revealableChange(file("a‮b.md")), false);
  assert.equal(revealableChange(file("changed-later.md", { state: "changed_since_run" })), true);
});

test("U-66: the switches redraw the loaded files side by side or in a column, wrapped or not, without asking again; show in folder by id", async () => {
  const restore = installFakeDom();
  try {
    let asked = 0;
    const revealed: [string, string][] = [];
    const api = {
      async changes(_workspace: string, runId: string) {
        asked += 1;
        return { ok: true, runId, recordsChanged: false, files: [{ ...file("notes.md"), id: "a".repeat(32) }, file("[key].md", { unavailable: "masked_path", before: null, after: null })] };
      },
      async reveal(workspace: string, id: string) {
        revealed.push([workspace, id]);
        return revealed.length === 1;
      },
    } as unknown as CodarynApi;
    const screen = changesScreen({ texts: textsFor("en"), api, current: () => ({ handle: HANDLE, name: "ws" }) });
    const root = new FakeElement("main");
    screen.choose(RUN_ID, null, null);
    screen.show(root as unknown as HTMLElement);
    await settle();
    const byId = (id: string): FakeElement | undefined => root.findAll((e) => e.getAttribute("id") === id)[0];
    const body = byId("changes");
    assert.equal(body?.getAttribute("data-view"), "column");
    assert.equal(body?.getAttribute("data-wrap"), "on");
    assert.equal(root.querySelectorAll("ol").length, 1);
    assert.equal(root.querySelectorAll("table").length, 0);

    const side = byId("changes-side");
    assert.ok(side);
    (side as unknown as { checked: boolean }).checked = true;
    side.dispatch("change");
    assert.equal(body?.getAttribute("data-view"), "side");
    const table = root.querySelectorAll("table")[0];
    assert.ok(table, "a side-by-side table");
    assert.equal(table.getAttribute("aria-label"), "Line comparison of notes.md");
    const headers = table.findAll((e) => e.tagName === "th").map((e) => e.textContent);
    assert.deepEqual(headers, ["Before the run", "Now"]);
    const rows = table.findAll((e) => e.tagName === "tr" && e.hasAttribute("data-left"));
    assert.deepEqual(rows.map((r) => [r.getAttribute("data-left"), r.getAttribute("data-right"), r.hasAttribute("data-hunk")]), [
      ["same", "same", false],
      ["removed", "added", true],
    ]);
    assert.equal(root.querySelectorAll("ol").length, 0);

    const wrap = byId("changes-wrap");
    (wrap as unknown as { checked: boolean }).checked = false;
    wrap?.dispatch("change");
    assert.equal(body?.getAttribute("data-wrap"), "off");
    assert.equal(asked, 1, "the switches do not ask again");

    const buttons = root.querySelectorAll("[data-reveal]");
    assert.equal(buttons.length, 1, "only the file with an id can be shown in the folder");
    buttons[0]?.click();
    await settle();
    assert.deepEqual(revealed, [[HANDLE, "a".repeat(32)]]);
    const status = root.findAll((e) => e.getAttribute("class") === "reveal-status")[0];
    assert.equal(status?.getAttribute("data-revealed"), "ok");
    root.querySelectorAll("[data-reveal]")[0]?.click();
    await settle();
    assert.equal(root.findAll((e) => e.getAttribute("class") === "reveal-status")[0]?.getAttribute("data-revealed"), "no");

    // The view stays for the next opening while the window is open.
    screen.show(root as unknown as HTMLElement);
    await settle();
    assert.equal(byId("changes")?.getAttribute("data-view"), "side");
    assert.equal(byId("changes")?.getAttribute("data-wrap"), "off");
    for (const language of ["ko", "en"] as const) {
      const t = textsFor(language);
      for (const id of ["changes.sideBySide", "changes.wrap", "changes.before", "changes.now", "changes.revealFailed", "changes.viewLabel"]) assert.ok(t.has(id), `${language} ${id}`);
    }
  } finally {
    restore();
  }
});
