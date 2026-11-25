/** Report views and Markdown IPC checks. Public callers use ../ipc.js. */
import { MAX_ITEMS, count, hasOnlyKeys, isObj, isRunId, shortText, textList, WORD, hostCodeOf, numOrNull, TIME, DIGEST } from "./primitives.js";
import { toFinalMessage, maskingOf } from "./core.js";
import type { FinalMessageView, MaskingView, RunResultView } from "./core.js";

/** GU-3 (3.7): one check of a run's last round, by number (N-24 (a)). */
export interface ReportVerifierView {
  readonly number: number;
  readonly kind: string | null;
  readonly outcome: string;
  readonly evidence: string;
  readonly evidenceCut: boolean;
  readonly checked: readonly string[];
  readonly limits: readonly string[];
}

/** GU-3 (3.7): a run's report as the window shows it. Texts are masked and cleaned. */
export interface ReportView {
  readonly runId: string;
  /** UXM-14, DR-38: the run has a records-changed mark; its records are not to be trusted. */
  readonly recordsChanged?: boolean;
  /** U-21 (DR-47): the agent's last message from the run's result; null when there is none. */
  readonly finalMessage?: FinalMessageView | null;
  /** U-40 (DR-52): the masking counts from the run's result; null when there are none or they are not counts. */
  readonly masking?: MaskingView | null;
  /** U-79 (3.7): a run waiting for its review: the workflow's checklist from its result; null otherwise. */
  readonly review?: { readonly checklist: readonly string[] } | null;
  readonly kind: "run" | "apply";
  readonly status: "complete" | "incomplete";
  readonly finished: { readonly status: string; readonly reason: string } | null;
  readonly usage: RunResultView["usage"] | null;
  readonly verifiers: readonly ReportVerifierView[];
  readonly integrity: readonly { readonly phase: string; readonly changed: readonly string[] }[];
  readonly records: number | null;
  readonly taskId: string;
  readonly run: {
    readonly workflow: string;
    readonly provider: string | null;
    readonly modelRequests: number | null;
    readonly deniedToolCalls: number | null;
    readonly repairs: number | null;
    readonly changes: readonly { readonly path: string; readonly created: boolean }[];
    readonly verdict: { readonly verdict: "accepted" | "rejected"; readonly at: string; readonly note: string | null } | null;
  } | null;
  readonly apply: {
    readonly planRunId: string | null;
    readonly digest: string | null;
    readonly approval: string | null;
    readonly unsafeMoveConsent: string | null;
    readonly actions: number | null;
    readonly unsafeMoves: number | null;
    readonly inventoryLimitReached: boolean;
    readonly moved: readonly { readonly from: string; readonly to: string; readonly unsafe: boolean }[];
    readonly discarded: readonly { readonly path: string }[];
    readonly failed: readonly { readonly number: number; readonly problem: string }[];
  } | null;
}

/** `labels`: the shared catalog's words for the finished status and reason, added by the main process. */
export type ReportReply =
  | { readonly ok: true; readonly view: ReportView; readonly labels?: { readonly status: string; readonly reason: string } | null }
  | { readonly ok: false; readonly code: string };

const wordOrNull = (value: unknown): value is string | null => value === null || (typeof value === "string" && WORD.test(value));
const MAX_EVIDENCE = 5000;

/** The engine host's report value, checked field by field. */
export function toReportReply(value: unknown): ReportReply {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  const fail = { ok: false, code: "host_error" } as const;
  const { runId, kind, status, finished, usage, verifiers, integrity, records, taskId } = value;
  const recordsChanged = value["recordsChanged"] ?? false;
  if (typeof recordsChanged !== "boolean") return fail;
  const finalMessage = toFinalMessage(value["finalMessage"]);
  if (finalMessage === "bad") return fail;
  if (!isRunId(runId) || (kind !== "run" && kind !== "apply") || (status !== "complete" && status !== "incomplete") || !shortText(taskId) || !numOrNull(records)) return fail;
  let finishedView: ReportView["finished"] = null;
  if (finished !== null) {
    if (!isObj(finished) || typeof finished["status"] !== "string" || !WORD.test(finished["status"]) || typeof finished["reason"] !== "string" || !WORD.test(finished["reason"])) return fail;
    finishedView = { status: finished["status"], reason: finished["reason"] };
  }
  let usageView: ReportView["usage"] = null;
  if (usage !== null) {
    if (!isObj(usage)) return fail;
    const { turns, tools, inputTokens, outputTokens, durationMs } = usage;
    if (![turns, tools, inputTokens, outputTokens, durationMs].every(numOrNull)) return fail;
    usageView = { turns: turns as number | null, tools: tools as number | null, inputTokens: inputTokens as number | null, outputTokens: outputTokens as number | null, durationMs: durationMs as number | null };
  }
  if (!Array.isArray(verifiers) || verifiers.length > MAX_ITEMS || !Array.isArray(integrity) || integrity.length > MAX_ITEMS) return fail;
  const verifierViews: ReportVerifierView[] = [];
  for (const verifier of verifiers) {
    if (!isObj(verifier) || !count(verifier["number"]) || !wordOrNull(verifier["kind"]) || typeof verifier["outcome"] !== "string" || !WORD.test(verifier["outcome"])) return fail;
    if (typeof verifier["evidence"] !== "string" || verifier["evidence"].length > MAX_EVIDENCE || typeof verifier["evidenceCut"] !== "boolean" || !textList(verifier["checked"]) || !textList(verifier["limits"])) return fail;
    verifierViews.push({ number: verifier["number"], kind: verifier["kind"] as string | null, outcome: verifier["outcome"], evidence: verifier["evidence"], evidenceCut: verifier["evidenceCut"], checked: verifier["checked"], limits: verifier["limits"] });
  }
  const integrityViews: { phase: string; changed: string[] }[] = [];
  for (const check of integrity) {
    if (!isObj(check) || typeof check["phase"] !== "string" || !WORD.test(check["phase"]) || !textList(check["changed"])) return fail;
    integrityViews.push({ phase: check["phase"], changed: check["changed"] });
  }
  let run: ReportView["run"] = null;
  let apply: ReportView["apply"] = null;
  if (kind === "run") {
    const r = value["run"];
    if (!isObj(r) || !shortText(r["workflow"]) || !wordOrNull(r["provider"]) || ![r["modelRequests"], r["deniedToolCalls"], r["repairs"]].every(numOrNull) || !Array.isArray(r["changes"]) || r["changes"].length > MAX_ITEMS) return fail;
    const changes: { path: string; created: boolean }[] = [];
    for (const change of r["changes"]) {
      if (!isObj(change) || !shortText(change["path"]) || typeof change["created"] !== "boolean") return fail;
      changes.push({ path: change["path"], created: change["created"] });
    }
    let verdict: NonNullable<ReportView["run"]>["verdict"] = null;
    const given = r["verdict"];
    if (given !== null) {
      if (!isObj(given) || (given["verdict"] !== "accepted" && given["verdict"] !== "rejected") || typeof given["at"] !== "string" || !TIME.test(given["at"]) || !(given["note"] === null || shortText(given["note"]))) return fail;
      verdict = { verdict: given["verdict"], at: given["at"], note: given["note"] as string | null };
    }
    run = { workflow: r["workflow"], provider: r["provider"] as string | null, modelRequests: r["modelRequests"] as number | null, deniedToolCalls: r["deniedToolCalls"] as number | null, repairs: r["repairs"] as number | null, changes, verdict };
  } else {
    const a = value["apply"];
    if (!isObj(a) || !(a["planRunId"] === null || isRunId(a["planRunId"])) || !(a["digest"] === null || (typeof a["digest"] === "string" && DIGEST.test(a["digest"])))) return fail;
    if (!wordOrNull(a["approval"]) || !wordOrNull(a["unsafeMoveConsent"]) || !numOrNull(a["actions"]) || !numOrNull(a["unsafeMoves"]) || typeof a["inventoryLimitReached"] !== "boolean") return fail;
    if (!Array.isArray(a["moved"]) || a["moved"].length > MAX_ITEMS || !Array.isArray(a["discarded"]) || a["discarded"].length > MAX_ITEMS || !Array.isArray(a["failed"]) || a["failed"].length > MAX_ITEMS) return fail;
    const moved: { from: string; to: string; unsafe: boolean }[] = [];
    for (const item of a["moved"]) {
      if (!isObj(item) || !shortText(item["from"]) || !shortText(item["to"]) || typeof item["unsafe"] !== "boolean") return fail;
      moved.push({ from: item["from"], to: item["to"], unsafe: item["unsafe"] });
    }
    const discarded: { path: string }[] = [];
    for (const item of a["discarded"]) {
      if (!isObj(item) || !shortText(item["path"])) return fail;
      discarded.push({ path: item["path"] });
    }
    const failed: { number: number; problem: string }[] = [];
    for (const item of a["failed"]) {
      if (!isObj(item) || !count(item["number"]) || typeof item["problem"] !== "string" || !WORD.test(item["problem"])) return fail;
      failed.push({ number: item["number"], problem: item["problem"] });
    }
    apply = {
      planRunId: a["planRunId"] as string | null,
      digest: a["digest"] as string | null,
      approval: a["approval"] as string | null,
      unsafeMoveConsent: a["unsafeMoveConsent"] as string | null,
      actions: a["actions"] as number | null,
      unsafeMoves: a["unsafeMoves"] as number | null,
      inventoryLimitReached: a["inventoryLimitReached"],
      moved,
      discarded,
      failed,
    };
  }
  const masking = maskingOf(value["masking"]);
  const given = value["review"] ?? null;
  if (!(given === null || (isObj(given) && hasOnlyKeys(given, ["checklist"]) && textList(given["checklist"])))) return fail;
  const review = given === null ? null : { checklist: given["checklist"] as string[] };
  return { ok: true, view: { runId, kind, status, recordsChanged, finalMessage, masking, review, finished: finishedView, usage: usageView, verifiers: verifierViews, integrity: integrityViews, records: records as number | null, taskId, run, apply } };
}

/** GU-3 (3.7): a saved report: the name of the file the person chose (never its folder), or why not (not_saved, ...). */
export type SaveReportReply = { readonly ok: true; readonly name: string } | { readonly ok: false; readonly code: string };

/** The engine host's Markdown value, checked. */
export function toHostReportMarkdown(value: unknown): { readonly ok: true; readonly text: string } | { readonly ok: false; readonly code: string } {
  if (!isObj(value) || value["ok"] !== true) return { ok: false, code: hostCodeOf(value) };
  return typeof value["text"] === "string" && value["text"].length <= 5_000_000 ? { ok: true, text: value["text"] } : { ok: false, code: "host_error" };
}
