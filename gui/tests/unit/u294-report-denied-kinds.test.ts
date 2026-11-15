/**
 * U-294 (ne-verify's R-113 L-2): the report's summary told every denial to "change the permission rules",
 * but that opens only a denied command. The CLI's end summary says what to do by the reason: a command
 * (policy.commands), a write outside writablePaths, a path kept from the agent on purpose
 * (unreadablePaths). The report gives no count by reason, so the summary now says, reason by reason with
 * the words the records' denial lines use, what opens it: a protected path only by taking it out of the
 * protected paths, and a path outside the workspace or the run record folder by nothing.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { reportValue } from "../../src/engine-host/report.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";
import { reportScreen } from "../../src/renderer/report/report-screen.js";
import { toReportReply } from "../../src/shared/ipc.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const RUN = "20261114T070000Z-0000a294";
const same = (text: string): string => text;
const KINDS = ["command", "notWritable", "unreadable", "protected", "fixed"] as const;

test("U-294 (R-113 L-2): the summary says what to do for each reason a call is denied for, not one rule for all", async () => {
  const restore = installFakeDom();
  try {
    const output = {
      schemaVersion: 1,
      kind: "report",
      runId: RUN,
      status: "complete",
      exitCode: 0,
      result: { schemaVersion: 1, kind: "run", runId: RUN, status: "done", reason: "verified", exitCode: 0, verifiers: [], changes: [], usage: { modelTurns: 1, toolCalls: 2, inputTokens: 1, outputTokens: 1, durationMs: 10 }, notices: [] },
      journal: { taskId: "task", workflow: "edit", provider: "anthropic", limits: {}, records: 4, modelRequests: 1, deniedToolCalls: 2, repairs: 0, lastRound: [], changes: [], integrityChecks: [], finished: { status: "done", reason: "verified" } },
    };
    const reply = toReportReply(reportValue({ ok: true, output }, same, same));
    assert.ok(reply.ok);
    const api = new Proxy({} as CodarynApi, { get: (_t, name: string) => (name === "report" ? async () => ({ ...reply, labels: { status: "S", reason: "R" } }) : async () => null) });
    const screen = reportScreen({ texts: textsFor("ko"), api, current: () => ({ handle: "1".repeat(32), name: "ws" }), openChanges: () => undefined, openSettings: () => undefined });
    screen.choose(RUN);
    const root = new FakeElement("main");
    screen.show(root as unknown as HTMLElement);
    await settle();
    await settle();
    const items = root.findAll((e) => e.hasAttribute("data-denial"));
    assert.deepEqual(items.map((li) => li.getAttribute("data-denial")), [...KINDS]);
    assert.deepEqual(items.map((li) => li.textContent), KINDS.map((kind) => KO[`report.deniedKind.${kind}`]));
    assert.equal(KO["report.deniedHow"].includes(KO["settings.rules"]), false, "the permission rules are not offered for every denial");
  } finally {
    restore();
  }
});

test("U-294 (R-113 L-2): each reason opens with the records' own words for it and says what opens it, in both languages", () => {
  // The words of the CLI's denial reasons (src/i18n), as the records' lines show them.
  const words = {
    ko: { command: ["허용 목록에 없음", "허용하지 않은 인자"], notWritable: ["쓰기 허용 경로 밖"], unreadable: ["읽기 제외 경로"], protected: ["보호 경로"], fixed: ["작업 공간 밖 경로", "실행 기록 폴더(.codaryn)"] },
    en: { command: ["not in the allowed commands", "arguments not allowed"], notWritable: ["not among the files this task may write"], unreadable: ["a path this task may not read"], protected: ["protected path"], fixed: ["path outside the workspace", "the run record folder (.codaryn)"] },
  } as const;
  for (const [language, table] of [["ko", KO], ["en", EN]] as const) {
    for (const kind of KINDS) {
      const text = table[`report.deniedKind.${kind}`];
      const head = text.slice(0, text.indexOf(":"));
      for (const word of words[language][kind]) assert.ok(head.toLowerCase().includes(word.toLowerCase()), `${language} ${kind}: ${word}`);
    }
    assert.ok(table["report.deniedKind.command"].includes(table["settings.rules"]), `${language}: a command, in the permission rules`);
    assert.ok(table["report.deniedKind.notWritable"].includes("writablePaths"), `${language}: writablePaths`);
    assert.ok(table["report.deniedKind.unreadable"].includes("unreadablePaths") && table["report.deniedKind.unreadable"].includes(table["settings.private"]), `${language}: unreadablePaths, on purpose, and where`);
    assert.ok(table["report.deniedKind.protected"].includes("protectedPaths"), `${language}: protectedPaths`);
  }
});
