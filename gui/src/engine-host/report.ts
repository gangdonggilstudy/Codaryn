/**
 * GU-3 (docs/design/standalone-gui.md 3.7): a run's report, as the window may see it, built from
 * the app layer's `report` (the structured ReportOutput, never Markdown turned into HTML). Every
 * text passes `shown` (names) or `shownText` (evidence, lines kept); evidence is cut at
 * MAX_EVIDENCE_CHARS. Verifiers are given by number, not by id (N-24 (a)). No path of the workspace
 * or the journal goes on.
 */

import { failureOf } from "./settings.js";
import type { HostFailure, Shown } from "./settings.js";

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const WORD = /^[a-z][a-z_-]{0,39}$/;
const RUN_ID = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/;
const MAX_LIST = 1000;
export const MAX_EVIDENCE_CHARS = 4000;

const word = (value: unknown): string | null => (typeof value === "string" && WORD.test(value) ? value : null);
const count = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value.slice(0, MAX_LIST) : []);
const texts = (value: unknown, shown: Shown): string[] => list(value).flatMap((item) => (typeof item === "string" ? [shown(item)] : []));

function verifiers(value: unknown, shown: Shown, shownText: Shown): Obj[] {
  return list(value).flatMap((verifier, index) => {
    if (!isObj(verifier) || word(verifier["outcome"]) === null) return [];
    const evidence = typeof verifier["evidence"] === "string" ? shownText(verifier["evidence"]) : "";
    return [
      {
        number: index + 1,
        kind: word(verifier["kind"]),
        outcome: verifier["outcome"],
        evidence: evidence.length > MAX_EVIDENCE_CHARS ? evidence.slice(0, MAX_EVIDENCE_CHARS) : evidence,
        evidenceCut: evidence.length > MAX_EVIDENCE_CHARS,
        checked: texts(verifier["checked"], shown),
        limits: texts(verifier["limits"], shown),
      },
    ];
  });
}

function integrity(value: unknown, shown: Shown): Obj[] {
  return list(value).flatMap((check) => (isObj(check) && word(check["phase"]) !== null ? [{ phase: check["phase"], changed: texts(check["changed"], shown) }] : []));
}

function finished(value: unknown): Obj | null {
  return isObj(value) && word(value["status"]) !== null && word(value["reason"]) !== null ? { status: value["status"], reason: value["reason"] } : null;
}

function usage(result: unknown): Obj | null {
  const used = isObj(result) && isObj(result["usage"]) ? result["usage"] : null;
  if (used === null) return null;
  return {
    turns: count(used["modelTurns"]),
    tools: count(used["toolCalls"]),
    inputTokens: count(used["inputTokens"]),
    outputTokens: count(used["outputTokens"]),
    durationMs: count(used["durationMs"]),
  };
}

/** `report` → the report view (ReportView in src/shared/ipc.ts) or a failure. */
export function reportValue(outcome: unknown, shown: Shown, shownText: Shown): Obj | HostFailure {
  if (!isObj(outcome) || outcome["ok"] !== true || !isObj(outcome["output"])) return failureOf(outcome);
  const output = outcome["output"];
  const journal = isObj(output["journal"]) ? output["journal"] : {};
  const runId = typeof output["runId"] === "string" && RUN_ID.test(output["runId"]) ? output["runId"] : null;
  const base = {
    ok: true,
    runId,
    // UXM-14, DR-38: the run's records are not to be trusted (absent: false).
    recordsChanged: output["recordsChanged"] === true,
    status: output["status"] === "incomplete" ? "incomplete" : "complete",
    finished: finished(journal["finished"]),
    usage: usage(output["result"]),
    verifiers: verifiers(journal["lastRound"], shown, shownText),
    integrity: integrity(journal["integrityChecks"], shown),
    records: count(journal["records"]),
    taskId: typeof journal["taskId"] === "string" ? shown(journal["taskId"]) : "",
  };
  if (output["runKind"] === "apply") {
    const checked = isObj(journal["checked"]) ? journal["checked"] : null;
    return {
      ...base,
      kind: "apply",
      apply: {
        planRunId: typeof journal["planRunId"] === "string" && RUN_ID.test(journal["planRunId"]) ? journal["planRunId"] : null,
        digest: typeof journal["digest"] === "string" && /^[0-9a-f]{64}$/.test(journal["digest"]) ? journal["digest"] : null,
        approval: word(journal["approval"]),
        unsafeMoveConsent: word(journal["unsafeMoveConsent"]),
        actions: count(journal["actions"]),
        unsafeMoves: checked === null ? null : count(checked["unsafeMoves"]),
        inventoryLimitReached: checked !== null && checked["inventoryLimitReached"] === true,
        moved: list(journal["moved"]).flatMap((item) =>
          isObj(item) && typeof item["from"] === "string" && typeof item["to"] === "string" ? [{ from: shown(item["from"]), to: shown(item["to"]), unsafe: item["unsafe"] === true }] : [],
        ),
        discarded: list(journal["discarded"]).flatMap((item) => (isObj(item) && typeof item["path"] === "string" ? [{ path: shown(item["path"]) }] : [])),
        failed: list(journal["failed"]).flatMap((item) => (isObj(item) && word(item["problem"]) !== null ? [{ number: (count(item["index"]) ?? 0) + 1, problem: item["problem"] }] : [])),
      },
    };
  }
  const verdict = output["verdict"];
  return {
    ...base,
    kind: "run",
    run: {
      workflow: typeof journal["workflow"] === "string" ? shown(journal["workflow"]) : "",
      provider: word(journal["provider"]),
      modelRequests: count(journal["modelRequests"]),
      deniedToolCalls: count(journal["deniedToolCalls"]),
      repairs: count(journal["repairs"]),
      changes: list(journal["changes"]).flatMap((change) => (isObj(change) && typeof change["path"] === "string" ? [{ path: shown(change["path"]), created: change["created"] === true }] : [])),
      verdict:
        isObj(verdict) && (verdict["verdict"] === "accepted" || verdict["verdict"] === "rejected") && typeof verdict["at"] === "string"
          ? { verdict: verdict["verdict"], at: verdict["at"], note: typeof verdict["note"] === "string" ? shown(verdict["note"]) : null }
          : null,
    },
  };
}

/** A saved report's longest text (characters); longer ones are refused, not cut. */
export const MAX_REPORT_MARKDOWN_CHARS = 5_000_000;

/**
 * GU-3 (3.7): `reportMarkdown` → `{ok, text}`. The app layer gives the report as `codaryn report`
 * prints it, every provider's key value hidden; each line passes `shownText` here too (control
 * characters replaced, key shapes and values hidden), as every text the GUI hands on does.
 */
export function reportMarkdownValue(outcome: unknown, shownText: Shown): Obj | HostFailure {
  if (!isObj(outcome) || outcome["ok"] !== true) return failureOf(outcome);
  const output = outcome["output"];
  if (!isObj(output) || output["kind"] !== "report_markdown" || typeof output["markdown"] !== "string") return { ok: false, code: "host_error" };
  const text = output["markdown"]
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => shownText(line))
    .join("\n");
  return text.length > MAX_REPORT_MARKDOWN_CHARS ? { ok: false, code: "too_large" } : { ok: true, text };
}
