/**
 * U-5 (GU-3, 3.6, 3.7): saving a run's report and the end notification; R33b-I1: the third cleanup
 * dialog says what keeping the discard boxes means. The engine host's Markdown call, the main
 * process's check and file writing, the notification and dialog texts, and the report screen's
 * save button with a DOM stand-in.
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createHostHandler } from "../../src/engine-host/host.js";
import { MAX_REPORT_MARKDOWN_CHARS } from "../../src/engine-host/report.js";
import { cleanupDiscardedDetail, endNotice } from "../../src/main/dialog-texts.js";
import { reportFileName, writeTextFile } from "../../src/main/save-file.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { saveReportButton } from "../../src/renderer/report/report-screen.js";
import { toHostReportMarkdown } from "../../src/shared/ipc.js";
import { parseHostMessage } from "../../src/shared/protocol.js";
import type { HostMessage } from "../../src/shared/protocol.js";
import { fakeApp } from "./fake-app.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const WS = path.resolve("ws-for-report-save");
const RUN = "20261112T010203Z-0000abcd";

function host(markdown: (request: unknown) => unknown) {
  const written: HostMessage[] = [];
  const handler = createHostHandler({
    app: fakeApp({ reportMarkdown: async (request) => markdown(request) }),
    messages: { texts: () => ({ language: "en", texts: {} }) },
    tree: async () => null,
    shown: (text) => text,
    shownText: (text) => `<${text.replace(/[\u0000-\u001f]/g, "?")}>`,
    providers: [],
    itemsIn: () => () => null,
    token: () => "0".repeat(32),
    write: (line) => written.push(parseHostMessage(line.trimEnd()) as HostMessage),
    log: () => undefined,
  });
  return async (id: number, args: unknown): Promise<unknown> => {
    await handler.handleLine(JSON.stringify({ v: 1, id, call: "reportMarkdown", args }));
    const message = written.find((m) => "id" in m && m.id === id) as { ok: boolean; value?: unknown; error?: { code: string } };
    return message.ok ? message.value : message.error?.code;
  };
}

test("report save: the engine host cleans every line of the app layer's Markdown; the main process checks it", async () => {
  const asked: unknown[] = [];
  const call = host((request) => {
    asked.push(request);
    return { ok: true, output: { kind: "report_markdown", markdown: "# Run\r\nline\u0007two\n", exitCode: 0 } };
  });
  assert.equal(await call(1, { workspace: WS, runId: "latest" }), "invalid_args");
  const value = await call(2, { workspace: WS, runId: RUN });
  assert.deepEqual(asked, [{ workspace: WS, runId: RUN }]);
  assert.deepEqual(toHostReportMarkdown(value), { ok: true, text: "<# Run>\n<line?two>\n<>" });
  const wrongKind = host(() => ({ ok: true, output: { kind: "report", markdown: "x" } }));
  assert.deepEqual(await wrongKind(1, { workspace: WS, runId: RUN }), { ok: false, code: "host_error" });
  const huge = host(() => ({ ok: true, output: { kind: "report_markdown", markdown: "x".repeat(MAX_REPORT_MARKDOWN_CHARS) } }));
  assert.deepEqual(await huge(1, { workspace: WS, runId: RUN }), { ok: false, code: "too_large" }, "refused, not cut");
  const failed = host(() => ({ ok: false, error: { code: "run_not_found", message: "C:\\x" } }));
  assert.deepEqual(await failed(1, { workspace: WS, runId: RUN }), { ok: false, code: "run_not_found" });
  assert.equal(toHostReportMarkdown({ ok: true, text: 3 }).ok, false);
});

test("report save: the file is written whole through a temporary file, replacing an old one; its name is the run id only", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-gui-save-"));
  try {
    const file = path.join(dir, reportFileName(RUN));
    assert.equal(path.basename(file), `codaryn-report-${RUN}.md`);
    await fs.writeFile(file, "old");
    await writeTextFile(file, "# new\n");
    assert.equal(await fs.readFile(file, "utf8"), "# new\n");
    assert.deepEqual(await fs.readdir(dir), [path.basename(file)], "no temporary file is left");
    await assert.rejects(writeTextFile(path.join(dir, "missing", "x.md"), "x"));
    assert.deepEqual(await fs.readdir(dir), [path.basename(file)]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("end notification (3.6): none while the window is active; else the fixed text and the status word only", () => {
  assert.equal(endNotice("en", true, "done"), null);
  assert.deepEqual(endNotice("en", false, "needs input"), { title: "Codaryn", body: "A Codaryn run ended: needs input" });
  assert.deepEqual(endNotice("ko", false, "확인 필요"), { title: "Codaryn", body: "Codaryn 실행이 끝났습니다: 확인 필요" });
  assert.equal(endNotice("en", false, null)?.body, "A Codaryn run ended. See the run list for its result.");
  assert.equal(endNotice("en", false, "a\u0007b")?.body, "A Codaryn run ended: a?b", "control characters replaced");
  assert.ok((endNotice("en", false, "x".repeat(300))?.body.length ?? 0) < 80, "a status word only");
});

test("R33b-I1: the discard boxes' dialog says what keeping them means for the apply runs whose records go", () => {
  assert.doesNotMatch(cleanupDiscardedDetail("en", 0), /can no longer be put back/);
  assert.match(cleanupDiscardedDetail("en", 2), /If you keep them, the files in the discard boxes of the 2 apply runs whose records go can no longer be put back by a revert\./);
  assert.match(cleanupDiscardedDetail("ko", 1), /보관함을 남기면, 기록이 지워지는 적용 실행 1개의 보관함 파일은 되돌리기로 제자리에 되살릴 수 없게 됩니다\./);
  assert.match(cleanupDiscardedDetail("en", 1), /^The discard boxes hold people's files/, "what deleting means comes first");
});

test("report save (3.7): the button asks the main process to save and names the file it was saved as", async () => {
  const restore = installFakeDom();
  try {
    const calls: unknown[][] = [];
    const replies = [{ ok: true, name: `codaryn-report-${RUN}.md` }, { ok: false, code: "not_saved" }, { ok: false, code: "save_failed" }];
    const api = new Proxy({} as CodarynApi, {
      get: (_t, name: string) => async (...args: unknown[]) => {
        if (name !== "saveReport") return null;
        calls.push(args);
        return replies.shift();
      },
    });
    const root = new FakeElement("div");
    root.append(...(saveReportButton(textsFor("en"), api, { handle: "1".repeat(32), name: "ws" }, RUN, "report-save") as unknown as FakeElement[]));
    const save = root.findAll((e) => e.getAttribute("id") === "report-save")[0];
    const status = root.findAll((e) => e.getAttribute("id") === "report-save-status")[0];
    save?.click();
    await settle();
    assert.deepEqual(calls, [["1".repeat(32), RUN]], "the workspace handle and the run id only");
    assert.equal(status?.textContent, `The report was saved: codaryn-report-${RUN}.md`);
    save?.click();
    await settle();
    assert.equal(status?.textContent, "It was not saved.");
    assert.equal(status?.getAttribute("data-saved"), "not_saved");
    save?.click();
    await settle();
    assert.match(status?.textContent ?? "", /could not be written/);
  } finally {
    restore();
  }
});
