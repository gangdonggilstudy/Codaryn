/**
 * U-38 (DR-51, contract 736e6d0), the human renderer's part: the next-command hints of the end
 * summaries (run, apply, revert) show the workspace path the person typed, when the context carries
 * it (`workspaceShown`, a ShownWorkspace from toShownWorkspace: masked, checked, in double quotes).
 * - run and apply: with workspaceForm "given" only. Report and revert use summary.next_report_typed and
 *   summary.next_revert_typed; plan, apply, review and the unsafe-move consent take
 *   summary.form.typed as their form. "current" and "task" stay as they are.
 * - revert (R-70 L-1, PM): its unsafe-move consent always says `<workspace>`, a context given or not:
 *   revert knows no registered values, so a typed path there is never checked against them.
 * - Absent, or a value that is not exactly what toShownWorkspace makes, or one the line's own
 *   cleaning would change: `<workspace>` as before (fail closed).
 * Paths: spaces, Hangul, a Windows path, combining marks and the signs of the allow list (R-70 M-1,
 * contract ac2d25f: ( ) , + = @ _ - . : / and the backslash) are shown; any other character (a
 * quote, the curly and small curly quotes PowerShell also reads as quotes, `x”;cmd;#`, a control
 * character, `$`, `%`, `;`, `#` and the rest), a path longer than MAX_SHOWN_WORKSPACE_CHARS, a
 * trailing backslash and a key shape give no ShownWorkspace, so the hint keeps `<workspace>`. The texts are the catalog owner's; a stand-in shows which ids
 * and values the renderer asks for, and the real lines in both languages are checked once the
 * catalog has them. Nothing is sent; fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MAX_SHOWN_WORKSPACE_CHARS, MESSAGE_LANGUAGES, toRunId, toShownWorkspace } from "../../../../src/contracts/index.js";
import type {
  ApplyResult,
  CatalogText,
  EngineResult,
  MessageCatalog,
  RevertOutput,
  RunId,
  RunSummaryContext,
  ShownWorkspace,
} from "../../../../src/contracts/index.js";
import { createHumanOutput } from "../../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../../src/i18n/index.js";
import { MESSAGE_TEXTS } from "../../../../src/i18n/catalog.js";

const RUN = toRunId("20261113T040506Z-0a1b2c3d") as RunId;
const PLAN_RUN = toRunId("20261113T030405Z-0b1c2d3e") as RunId;
const DIGEST = "cd".repeat(32);
const TYPED = ["sk", "ant", "FAKEfake0000FAKEfake0000FAKEfake00"].join("-");

const TYPED_IDS = ["summary.next_report_typed", "summary.next_revert_typed", "summary.next_revert_unsafe_typed", "summary.form.typed"];
/** Ids that take the form (a catalog text) or a workspace: marked, so the value they get shows. */
const MARKED = [...TYPED_IDS, "summary.next_report", "summary.next_revert", "summary.next_revert_unsafe", "summary.next_plan", "summary.next_apply", "summary.next_review", "summary.next_apply_unsafe", "summary.form.given"];

const real = createMessageCatalog("en");
const asReal = (catalog: MessageCatalog) => catalog.format as (id: string, ...rest: unknown[]) => CatalogText;
const standIn: MessageCatalog = {
  language: "en",
  format: ((id: string, ...params: unknown[]) =>
    MARKED.includes(id) ? (`<${id}${params[0] === undefined ? "" : ` ${JSON.stringify(params[0])}`}>` as CatalogText) : asReal(real)(id, ...params)) as MessageCatalog["format"],
};
const mark = (id: string, params?: Record<string, unknown>): string => `<${id}${params === undefined ? "" : ` ${JSON.stringify(params)}`}>`;

const shown = (typed: string): ShownWorkspace => {
  const value = toShownWorkspace(typed, typed);
  assert.ok(value !== null, typed);
  return value;
};
const SHOWN = ["my work", "작업 공간/보고서", "C:\\Users\\me\\My Work", "./ws", "/home/me/일/a b", "My Work (2)", "a+b=c@d,e", "프로젝트_1-2", "cafe\u0301"];
const NOT_SHOWN = [
  'my"work',
  "a\u0007b",
  "tab\there",
  "a\u202Eb",
  "$HOME/ws",
  "%USERPROFILE%\\ws",
  "a!b",
  "a`b",
  "C:\\ws\\",
  "x".repeat(MAX_SHOWN_WORKSPACE_CHARS + 1),
  `ws/${TYPED}`,
  "ws/codaryn_secret_1",
  "   ",
  // R-70 M-1: the curly and small curly quotes, and the shape that closed PowerShell's string.
  "x\u201D;cmd;#",
  "\u201Cws\u201D",
  "ws\u201E",
  "\u2018ws\u2019",
  // Other characters outside the allow list.
  "a;b", "a#b", "a&b", "a|b", "a<b", "a>b", "a'b", "a*b", "a?b", "a[b]", "a{b}", "a~b", "a^b", "a\u20ACb", "a\u3000b",
];

const context = (extra: Record<string, unknown> = {}): RunSummaryContext =>
  ({ workspaceForm: "given", configDefault: null, profileApplied: false, deniedToolCalls: 0, deniedCommandCalls: 0, policySource: "config", ...extra }) as unknown as RunSummaryContext;
const run = (extra: Record<string, unknown> = {}): EngineResult =>
  ({
    schemaVersion: 1, kind: "run", runId: RUN, taskId: "t", status: "done", reason: "verified", exitCode: 0, provider: "scripted",
    verifiers: [], changes: [{ path: "a.txt", created: false }], usage: { modelTurns: 1, toolCalls: 1, inputTokens: null, outputTokens: null, durationMs: 100 },
    journalPath: "x", notices: [], ...extra,
  }) as unknown as EngineResult;
const PLAN_PENDING = { status: "needs-input", reason: "plan_pending", exitCode: 3, changes: [], plan: { digest: DIGEST, actions: 1 } };
const AWAITING = { status: "needs-input", reason: "awaiting_review", exitCode: 3, changes: [], review: { checklist: ["the table is right"] } };
const apply = (extra: Record<string, unknown> = {}): ApplyResult =>
  ({
    schemaVersion: 1, kind: "apply", runId: RUN, planRunId: PLAN_RUN, taskId: "t", digest: DIGEST, status: "done", reason: "verified", exitCode: 0,
    applied: [{ index: 0, action: { kind: "move", from: "a.txt", to: "b/a.txt", sha256: DIGEST }, stored: null }], verifiers: [],
    usage: { modelTurns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 5 }, journalPath: "x", notices: [], ...extra,
  }) as unknown as ApplyResult;
const CONSENT = { status: "needs-input", reason: "consent_required", exitCode: 3, applied: [] };
const revert = (): RevertOutput =>
  ({
    schemaVersion: 1, kind: "revert", runId: RUN, status: "partial", exitCode: 3, dryRun: false,
    reverted: [], skipped: [{ path: "a.txt", reason: "unsafe_move" }],
  }) as unknown as RevertOutput;
const linesOf = (text: string): string[] => text.trimEnd().split("\n");

describe("U-38: the end summaries' hints with the typed workspace", () => {
  const out = createHumanOutput(standIn);

  test("toShownWorkspace: spaces, Hangul and a Windows path are shown; quotes, controls, shell marks, length, a trailing backslash and key shapes are not", () => {
    for (const typed of SHOWN) assert.equal(toShownWorkspace(typed, typed), `"${typed}"`, typed);
    for (const typed of NOT_SHOWN) assert.equal(toShownWorkspace(typed, typed), null, JSON.stringify(typed));
  });

  test("run, given: the report and revert hints take the typed path", () => {
    for (const typed of SHOWN) {
      const workspace = shown(typed);
      const lines = linesOf(out.runSummary(run(), context({ workspaceShown: workspace })));
      assert.ok(lines.includes(mark("summary.next_report_typed", { runId: RUN, workspace })), lines.join("\n"));
      assert.ok(lines.includes(mark("summary.next_revert_typed", { runId: RUN, workspace })), lines.join("\n"));
      assert.equal(lines.some((line) => line.startsWith("<summary.next_report {") || line.startsWith("<summary.next_revert {")), false, lines.join("\n"));
    }
  });

  test("run, given, plan pending and awaiting review: plan, apply and review take summary.form.typed", () => {
    const workspace = shown("작업 공간");
    const form = mark("summary.form.typed", { workspace });
    const planned = linesOf(out.runSummary(run(PLAN_PENDING), context({ workspaceShown: workspace })));
    assert.ok(planned.includes(mark("summary.next_plan", { form, runId: RUN })), planned.join("\n"));
    assert.ok(planned.includes(mark("summary.next_apply", { form, runId: RUN })), planned.join("\n"));
    const awaiting = linesOf(out.runSummary(run(AWAITING), context({ workspaceShown: workspace })));
    assert.ok(awaiting.includes(mark("summary.next_review", { form, runId: RUN })), awaiting.join("\n"));
  });

  test("run: without workspaceShown, with \"current\" or \"task\", the hints are as before", () => {
    const workspace = shown("my work");
    for (const [extra, result] of [[{}, run()], [{ workspaceForm: "current", workspaceShown: workspace }, run()], [{ workspaceForm: "task", workspaceShown: workspace }, run(PLAN_PENDING)]] as const) {
      const before = out.runSummary(result, context({ ...extra, workspaceShown: undefined }));
      assert.equal(out.runSummary(result, context(extra)), before, JSON.stringify(extra));
      assert.equal(before.includes("_typed"), false, before);
    }
  });

  test("a value that is not exactly a ShownWorkspace: <workspace> as before (fail closed)", () => {
    const before = out.runSummary(run(PLAN_PENDING), context());
    for (const value of ["my work", '"my"work"', '"a\u0007b"', '"x\u201D;cmd;#"', '"\u201Cws\u201D"', `"ws/${TYPED}"`, `"${"x".repeat(MAX_SHOWN_WORKSPACE_CHARS + 1)}"`, '""', '"C:\\ws\\"', 7, null, ["\"a\""]]) {
      assert.equal(out.runSummary(run(PLAN_PENDING), context({ workspaceShown: value })), before, JSON.stringify(value));
      assert.equal(out.runSummary(run(), context({ workspaceShown: value })), out.runSummary(run(), context()), JSON.stringify(value));
    }
  });

  test("a path that gives no ShownWorkspace is never passed on, so the hints stay as before", () => {
    for (const typed of NOT_SHOWN) {
      const value = toShownWorkspace(typed, typed);
      assert.equal(out.runSummary(run(), context(value === null ? {} : { workspaceShown: value })), out.runSummary(run(), context()), JSON.stringify(typed));
    }
  });

  test("apply, given: report, revert and the unsafe-move consent take the typed path", () => {
    const workspace = shown("my work");
    const done = linesOf(out.applySummary?.(apply(), { workspaceForm: "given", workspaceShown: workspace }) ?? "");
    assert.ok(done.includes(mark("summary.next_report_typed", { runId: RUN, workspace })), done.join("\n"));
    assert.ok(done.includes(mark("summary.next_revert_typed", { runId: RUN, workspace })), done.join("\n"));
    const consent = linesOf(out.applySummary?.(apply(CONSENT), { workspaceForm: "given", workspaceShown: workspace }) ?? "");
    assert.ok(consent.includes(mark("summary.next_apply_unsafe", { form: mark("summary.form.typed", { workspace }), runId: PLAN_RUN })), consent.join("\n"));
    // "task" and "current" stay as they are; so does a value that is not a ShownWorkspace.
    for (const ctx of [{ workspaceForm: "task", workspaceShown: workspace }, { workspaceForm: "current", workspaceShown: workspace }, { workspaceForm: "given", workspaceShown: "my work" }] as const) {
      const plain = out.applySummary?.(apply(CONSENT), { workspaceForm: ctx.workspaceForm });
      assert.equal(out.applySummary?.(apply(CONSENT), ctx as never), plain, JSON.stringify(ctx));
    }
  });

  test("revert (R-70 L-1): the unsafe-move consent always says <workspace>, a typed path given or not", () => {
    const plain = out.revertSummary(revert());
    assert.ok(linesOf(plain).includes(mark("summary.next_revert_unsafe", { runId: RUN })), plain);
    for (const typed of SHOWN) assert.equal(out.revertSummary(revert(), { workspaceShown: shown(typed) }), plain, typed);
    assert.equal(out.revertSummary(revert(), {}), plain);
    assert.equal(out.revertSummary(revert(), { workspaceShown: "my work" as ShownWorkspace }), plain);
    assert.equal(plain.includes("_typed"), false, plain);
  });

  test("the result objects are not changed (the JSON is the CLI's, built from them)", () => {
    const result = run(PLAN_PENDING);
    const copy = JSON.stringify(result);
    out.runSummary(result, context({ workspaceShown: shown("my work") }));
    assert.equal(JSON.stringify(result), copy);
  });
});

describe("U-38 with the real catalog", () => {
  const ready = MESSAGE_LANGUAGES.every((language) => TYPED_IDS.every((id) => Object.hasOwn(MESSAGE_TEXTS[language], id)));
  const skip = ready ? false : "the U-38 texts are not in the catalog yet (nb-i18n)";
  for (const language of MESSAGE_LANGUAGES) {
    test(`${language}: each typed hint is its placeholder hint with the quoted path in place of <workspace>`, { skip }, () => {
      const catalog = createMessageCatalog(language);
      const out = createHumanOutput(catalog);
      for (const typed of SHOWN) {
        const workspace = shown(typed);
        const typedText = linesOf(out.runSummary(run(PLAN_PENDING), context({ workspaceShown: workspace })));
        const placeholder = linesOf(createHumanOutput(createMessageCatalog(language)).runSummary(run(PLAN_PENDING), context()));
        assert.deepEqual(typedText, placeholder.map((line) => line.split("<workspace>").join(workspace)), typed);
        assert.ok(typedText.some((line) => line.includes(workspace)), typedText.join("\n"));
        // R-70 L-1: revert's hint keeps <workspace>.
        const reverted = out.revertSummary(revert(), { workspaceShown: workspace });
        assert.equal(reverted, createHumanOutput(createMessageCatalog(language)).revertSummary(revert()), typed);
        assert.ok(reverted.includes("<workspace>"), reverted);
      }
    });
  }
});
