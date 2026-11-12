/**
 * U-32 (GUI follow-up of U-14; UXM-14, UXM-24 of docs/design/ux-midpoint-review.md):
 * (1) the plan screen shows the plan's summary as the CLI's `plan` does: under a label that says
 *     it is the agent's words, through the engine's quoteModelText (keys hidden, invisible
 *     characters as "?", folded). A plan run with a records-changed mark has its warning first,
 *     no summary, and no apply: the main process gives no approval token for it.
 * (2) UXM-14: the mark where the CLI says it: the revert preview and result of a marked run, and
 *     the report's warning above its tabs (every tab is the records' content).
 * (3) UXM-24: every CLI command the window gives parses with the CLI's own argument reader.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createHostHandler } from "../../src/engine-host/host.js";
import type { HostDeps } from "../../src/engine-host/host.js";
import { modelTextOf } from "../../src/engine-host/model-text.js";
import type { QuoteModelText } from "../../src/engine-host/model-text.js";
import type { CodarynApi } from "../../src/renderer/api.js";
import { textsFor } from "../../src/renderer/i18n/catalog.js";
import { EN } from "../../src/renderer/i18n/en.js";
import { KO } from "../../src/renderer/i18n/ko.js";
import { applyCommands, planScreen } from "../../src/renderer/plan/plan-screen.js";
import { reportScreen } from "../../src/renderer/report/report-screen.js";
import { RunModel } from "../../src/renderer/run/run-model.js";
import { runsScreen } from "../../src/renderer/runs/runs-screen.js";
import { MAX_PLAN_SUMMARY_ROWS, planApprovable, toPlanView, toRevertView } from "../../src/shared/ipc.js";
import { parseHostMessage } from "../../src/shared/protocol.js";
import type { HostMessage } from "../../src/shared/protocol.js";
import { fakeApp } from "./fake-app.js";
import { FakeElement, installFakeDom, settle } from "./fake-dom.js";

const GUI = fileURLToPath(new URL("../../../", import.meta.url));
const ENGINE_DIR = path.join(GUI, "..", "dist", "src");
const ENGINE_BUILT = existsSync(path.join(ENGINE_DIR, "cli", "human", "format.js")) && existsSync(path.join(ENGINE_DIR, "cli", "args.js"));
const WS = path.resolve("ws-for-u32");
const RUN = "20261113T010203Z-0000abcd";
const DIGEST = "0123456789ab".padEnd(64, "c");
const HANDLE = "1".repeat(32);
const KEY_SHAPED = ["sk", "ant", "FAKE".repeat(10)].join("-");

const planOutput = (extra: Record<string, unknown> = {}) => ({
  ok: true,
  output: { kind: "plan", runId: RUN, status: "pending", exitCode: 0, digest: DIGEST, actions: [{ kind: "move", from: "a.txt", to: "x/a.txt" }], inventoryLimitReached: false, appliedBy: null, ...extra },
});

function host(app: Parameters<typeof fakeApp>[0], extra: Partial<HostDeps> = {}) {
  const written: HostMessage[] = [];
  const handler = createHostHandler({
    app: fakeApp(app),
    messages: { texts: () => ({ language: "en", texts: {} }) },
    tree: async () => null,
    shown: (text) => text,
    providers: [],
    itemsIn: () => () => null,
    token: () => "0".repeat(32),
    write: (line) => written.push(parseHostMessage(line.trimEnd()) as HostMessage),
    log: () => undefined,
    ...extra,
  });
  return async (id: number, call: string, args: unknown): Promise<unknown> => {
    await handler.handleLine(JSON.stringify({ v: 1, id, call, args }));
    const message = written.find((m) => "id" in m && m.id === id) as { ok: boolean; value?: unknown; error?: { code: string } };
    return message.ok ? message.value : message.error;
  };
}

const PLAN_ARGS = { workspace: WS, profile: null, workflowRef: "organize", runId: RUN };
const byLines = (text: string): string[] => text.split("\n");

test("U-32 (1): the plan's summary reaches the window as the agent's words in rows; a marked plan run has none and no approval", async () => {
  const call = host({ plan: async (request) => (request.runId === RUN ? planOutput({ summary: "Moves a.txt\ninto x." }) : planOutput()) }, { modelText: byLines });
  const shown = toPlanView(await call(1, "plan", PLAN_ARGS));
  assert.ok(shown.ok, JSON.stringify(shown));
  if (!shown.ok) return;
  assert.deepEqual(shown.view.summary, ["Moves a.txt", "into x."]);
  assert.equal(shown.view.recordsChanged, undefined, "absent: not marked");
  assert.equal(planApprovable(shown.view), true);

  const marked = host({ plan: async () => planOutput({ recordsChanged: true, summary: "still here" }) }, { modelText: byLines });
  const view = toPlanView(await marked(2, "plan", PLAN_ARGS));
  assert.ok(view.ok);
  if (!view.ok) return;
  assert.equal(view.view.recordsChanged, true);
  assert.equal(view.view.summary, undefined, "a marked plan run's summary is not shown (its journal may have changed too)");
  assert.equal(planApprovable(view.view), false, "no approval token for a marked plan: the engine refuses it, so nothing is asked");
  assert.equal(planApprovable({ ...shown.view, status: "applied" }), false);

  const without = host({ plan: async () => planOutput({ summary: "no quoting here" }) });
  const plain = toPlanView(await without(3, "plan", PLAN_ARGS));
  assert.ok(plain.ok && plain.view.summary === undefined, "without the engine's quoting the model's words are not shown");

  // The main process checks the rows: text without control characters, at most MAX_PLAN_SUMMARY_ROWS.
  const base = { ok: true, runId: RUN, status: "pending", digest: DIGEST, actions: [], inventoryLimitReached: false, appliedBy: null };
  assert.equal(toPlanView({ ...base, summary: ["ok\u001b[2J"] }).ok, false);
  assert.equal(toPlanView({ ...base, summary: ["a\nb"] }).ok, false);
  assert.equal(toPlanView({ ...base, summary: Array.from({ length: MAX_PLAN_SUMMARY_ROWS + 1 }, () => "x") }).ok, false);
  assert.equal(toPlanView({ ...base, summary: "one string" }).ok, false);
  assert.equal(toPlanView({ ...base, recordsChanged: "yes" }).ok, false);
  assert.equal(toPlanView({ ...base, summary: Array.from({ length: MAX_PLAN_SUMMARY_ROWS }, () => "x") }).ok, true);
});

test("U-32 (1): the summary passes the engine's quoteModelText, as the CLI's plan draws it", { skip: !ENGINE_BUILT && "the engine is not built (npm run build in the root)" }, async () => {
  const format = (await import(pathToFileURL(path.join(ENGINE_DIR, "cli", "human", "format.js")).href)) as { quoteModelText: QuoteModelText; MODEL_TEXT_PREFIX: string; MODEL_TEXT_COLUMNS: number };
  const safety = (await import(pathToFileURL(path.join(ENGINE_DIR, "cli", "text-safety.js")).href)) as { hideKeys(text: string, key: string | null): string };
  const current = "CURRENTVALUE1234567890";
  const rows = modelTextOf(format.quoteModelText, format.MODEL_TEXT_PREFIX, 20, (text) => safety.hideKeys(safety.hideKeys(text, null), current))(
    `Moves​files.   Key ${KEY_SHAPED}\nand ${current} ${"word ".repeat(40)}`,
  );
  const all = rows.join("\n");
  assert.ok(rows.length > 2, "folded into rows");
  assert.ok(!all.includes(KEY_SHAPED) && !all.includes(current), "key shapes and the current key value hidden");
  assert.ok(rows[0]?.startsWith("Moves?files. Key"), `invisible characters shown, runs of spaces as one: ${rows[0]}`);
  assert.ok(rows.every((row) => !row.startsWith(format.MODEL_TEXT_PREFIX) && row.length <= format.MODEL_TEXT_COLUMNS), "the CLI's quote mark left off; the window draws its own");
  const capped = modelTextOf(format.quoteModelText, format.MODEL_TEXT_PREFIX, 2, (text) => text)("a\nb\nc\nd");
  assert.deepEqual(capped, ["a", "b", "… (+2)"]);
  assert.deepEqual(modelTextOf(() => { throw new Error("x"); }, "| ", 2, (text) => text)("a"), [], "a quoting that throws shows nothing");
});

function planApi(view: Record<string, unknown>, approval: string | null): CodarynApi {
  return new Proxy({} as CodarynApi, { get: (_t, name: string) => async () => (name === "plan" ? { ok: true, view, approval } : null) });
}

async function planShown(view: Record<string, unknown>, approval: string | null, formKnown = true, language: "ko" | "en" = "en"): Promise<FakeElement> {
  const plan = planScreen({ texts: textsFor(language), api: planApi(view, approval), run: new RunModel(), current: () => ({ handle: HANDLE, name: "ws" }), showRun: () => undefined });
  plan.choose(RUN, null, "organize", formKnown, false);
  const root = new FakeElement("main");
  plan.show(root as unknown as HTMLElement);
  await settle();
  return root;
}

const byId = (root: FakeElement, id: string) => root.findAll((e) => e.getAttribute("id") === id)[0];
const VIEW = { runId: RUN, status: "pending", digest: DIGEST, actions: [{ kind: "move", from: "a.txt", to: "x/a.txt" }], inventoryLimitReached: false, appliedBy: null };

test("U-32 (1): the plan screen shows the summary under the agent's-words label; a marked plan has the warning first and no apply", async () => {
  const restore = installFakeDom();
  try {
    const plain = await planShown({ ...VIEW, summary: ["Moves a.txt", "into x."] }, "a".repeat(32));
    const words = byId(plain, "plan-agent-words");
    assert.ok(words !== undefined, "the summary is shown");
    assert.match(words.textContent, /agent's own words, not a verified fact/);
    assert.equal(byId(plain, "plan-agent-words-text")?.textContent, "Moves a.txt\ninto x.");
    assert.equal(byId(plain, "plan-agent-words-text")?.getAttribute("class"), "agent-words");
    const body = byId(plain, "plan");
    const order = body?.children.map((child) => child.getAttribute("id")) ?? [];
    assert.ok(order.indexOf("plan-actions") < order.indexOf("plan-agent-words"), `after the actions: ${order.join(",")}`);
    assert.ok(byId(plain, "plan-apply") !== undefined);
    assert.equal(byId(plain, "plan-records-changed"), undefined);

    // Marked by the plan view itself (not only by the run list), and a summary that should not be there.
    const marked = await planShown({ ...VIEW, recordsChanged: true, summary: ["should not show"] }, null);
    assert.equal(byId(marked, "plan")?.children[0]?.getAttribute("id"), "plan-records-changed", "the warning comes first");
    assert.match(byId(marked, "plan-records-changed")?.textContent ?? "", /^Warning: /);
    assert.equal(byId(marked, "plan-apply"), undefined, "no apply button");
    assert.match(byId(marked, "plan-cannot-apply")?.textContent ?? "", /Run the task again/);
    assert.equal(byId(marked, "plan-agent-words"), undefined, "no summary");
    assert.equal(byId(marked, "plan-applied"), undefined, "not called applied");

    const appliedMarked = await planShown({ ...VIEW, status: "applied", recordsChanged: true, appliedBy: { runId: "20261113T020304Z-0000beef", at: "2026-11-13T02:03:04.000Z" } }, null);
    assert.equal(byId(appliedMarked, "plan")?.children[0]?.getAttribute("id"), "plan-records-changed");
    assert.ok(byId(appliedMarked, "plan-applied")?.textContent.includes("20261113T020304Z-0000beef"));
    assert.equal(byId(appliedMarked, "plan-cannot-apply"), undefined);
  } finally {
    restore();
  }
});

type ParseOutcome = { readonly ok: boolean; readonly args?: { readonly runId?: string; readonly digest?: string | null; readonly provider?: string | null } };

test("UXM-24: every CLI command the window gives parses with the CLI's own argument reader", { skip: !ENGINE_BUILT && "the engine is not built (npm run build in the root)" }, async () => {
  const args = (await import(pathToFileURL(path.join(ENGINE_DIR, "cli", "args.js")).href)) as Record<string, (argv: readonly string[]) => ParseOutcome>;
  // A placeholder <...> is what the person fills in; here a value of that place.
  const argv = (command: string): string[] => command.replace(/<[^>]+>/g, "filled").split(" ").slice(1);
  for (const language of ["ko", "en"] as const) {
    const commands = applyCommands(textsFor(language), RUN, DIGEST);
    assert.equal(commands.length, 2, "a task file, or the workspace folder with its task type");
    for (const command of commands) {
      assert.match(command, /^codaryn apply /);
      const parsed = (args["parseApplyArgs"] as (argv: readonly string[]) => ParseOutcome)(argv(command));
      assert.ok(parsed.ok, `${language}: ${command}: ${JSON.stringify(parsed)}`);
      assert.equal(parsed.args?.runId, RUN);
      assert.equal(parsed.args?.digest, DIGEST.slice(0, 12), "the digest's first 12 characters");
    }
    const models = /codaryn models [^:]*$/.exec(textsFor(language).format("settings.providerNoList", { provider: "openai" }))?.[0];
    assert.ok(models !== undefined, `${language}: the models command`);
    const parsed = (args["parseModelsArgs"] as (argv: readonly string[]) => ParseOutcome)(argv(models));
    assert.ok(parsed.ok, `${language}: ${models}: ${JSON.stringify(parsed)}`);
  }
  // R46-L-2 and U-27's words stay: the form of the apply command, whose task part the person fills in.
  assert.match(EN["plan.formUnknown"], /form of the apply command/);
  assert.match(KO["plan.formUnknown"], /형식/);
});

test("UXM-24: a plan whose form this app does not know shows the apply commands with its run and digest", async () => {
  const restore = installFakeDom();
  try {
    const root = await planShown(VIEW, "a".repeat(32), false, "ko");
    const box = byId(root, "plan-form-unknown");
    assert.ok(box !== undefined);
    const commands = box.findAll((e) => e.tagName === "code").map((e) => e.textContent);
    assert.deepEqual(commands, applyCommands(textsFor("ko"), RUN, DIGEST));
    assert.ok(commands.every((command) => command.includes(`--run ${RUN} --digest ${DIGEST.slice(0, 12)}`)));
    assert.ok(commands[0]?.includes("--task <task 파일>") && commands[1]?.includes("--workspace <작업 공간 폴더> --workflow <작업 종류>"), commands.join(" | "));
    assert.equal(byId(root, "plan-apply"), undefined);
  } finally {
    restore();
  }
});

test("UXM-14: the revert of a marked run says so, as the CLI's revert does", async () => {
  const call = host({ revert: async () => ({ ok: true, output: { kind: "revert", runId: RUN, status: "complete", exitCode: 0, dryRun: true, reverted: [{ path: "a.txt", action: "restored", from: null, unsafe: false }], skipped: [], recordsChanged: true } }) });
  const reply = toRevertView(await call(1, "revert", { workspace: WS, runId: RUN, dryRun: true }));
  assert.ok(reply.ok && reply.view.recordsChanged === true, JSON.stringify(reply));
  const unmarked = host({ revert: async () => ({ ok: true, output: { kind: "revert", runId: RUN, status: "complete", exitCode: 0, dryRun: true, reverted: [], skipped: [] } }) });
  const plain = toRevertView(await unmarked(2, "revert", { workspace: WS, runId: RUN, dryRun: true }));
  assert.ok(plain.ok && plain.view.recordsChanged === undefined);

  const restore = installFakeDom();
  try {
    const row = { state: "checked", runId: RUN, kind: "run", startedAt: null, taskId: "quick", status: "complete", reason: "done", changes: 1, reverted: null, revertRecordDamaged: false, recordsChanged: true, form: null };
    const view = reply.ok ? reply.view : null;
    const api = new Proxy({} as CodarynApi, {
      get: (_t, name: string) => async () => {
        if (name === "listRuns") return { ok: true, runs: [row], omitted: 0 };
        if (name === "previewRevert") return { ok: true, view, preview: "b".repeat(32), consentRetry: null };
        return null;
      },
    });
    const screen = runsScreen({ texts: textsFor("en"), api, current: () => ({ handle: HANDLE, name: "ws" }), open: () => undefined, announce: () => undefined, openPlan: () => undefined, openChanges: () => undefined, openReport: () => undefined });
    const root = new FakeElement("main");
    screen.show(root as unknown as HTMLElement);
    await settle();
    root.findAll((e) => e.getAttribute("data-preview") === RUN)[0]?.click();
    await settle();
    assert.match(byId(root, "revert-records-changed")?.textContent ?? "", /still checks every file/);
    assert.equal(root.findAll((e) => e.getAttribute("data-records-changed") !== null).length, 1, "the run list's mark is the only data-records-changed");
  } finally {
    restore();
  }
});

test("UXM-14: the report's records-changed warning is above its tabs, so every tab has it", async () => {
  const restore = installFakeDom();
  try {
    const view = { runId: RUN, kind: "run", status: "complete", recordsChanged: true, finished: null, usage: null, verifiers: [], integrity: [], records: 1, taskId: "quick", run: null, apply: null };
    const api = new Proxy({} as CodarynApi, { get: (_t, name: string) => async () => (name === "report" ? { ok: true, view, labels: null } : null) });
    const screen = reportScreen({ texts: textsFor("en"), api, current: () => ({ handle: HANDLE, name: "ws" }), openChanges: () => undefined });
    screen.choose(RUN);
    const root = new FakeElement("main");
    screen.show(root as unknown as HTMLElement);
    await settle();
    const body = byId(root, "report");
    assert.equal(body?.children[0]?.getAttribute("id"), "report-records-changed", "first, before the tab list");
    assert.equal(body?.children[1]?.getAttribute("role"), "tablist");
    assert.equal(root.findAll((e) => e.getAttribute("id") === "report-records-changed").length, 1, "once");
    root.findAll((e) => e.getAttribute("data-tab") === "checks" && e.getAttribute("role") === "tab")[0]?.click();
    assert.ok(byId(root, "report-records-changed") !== undefined, "still there on another tab");
  } finally {
    restore();
  }
});
