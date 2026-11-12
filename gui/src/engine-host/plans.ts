/**
 * GU-5 (docs/design/standalone-gui.md 3.9, 3.7): a plan and a person's review, as the window may
 * see them. Built from the app layer's `plan` and `review` outputs. The plan's actions are masked
 * by the app layer with the task form's secrets (and refused as `plan_secrets_differ` when those
 * mask it otherwise than the plan run did, DR-28); every path passes `shown` here as well. The
 * digest goes on in full: the apply names it (DR-1), and the window shows its first 12 characters.
 */

import { failureOf } from "./settings.js";
import type { HostFailure, Shown } from "./settings.js";

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const DIGEST = /^[0-9a-f]{64}$/;
const RUN_ID = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/;
const MAX_ACTIONS = 10_000;

function outputOf(outcome: unknown): Obj | null {
  if (!isObj(outcome) || outcome["ok"] !== true || !isObj(outcome["output"])) return null;
  return outcome["output"];
}

/** `plan` → `{ok, runId, status, digest, actions, inventoryLimitReached, appliedBy}` or a failure. */
export function planValue(outcome: unknown, shown: Shown): Obj | HostFailure {
  const output = outputOf(outcome);
  if (output === null) return failureOf(outcome);
  const digest = output["digest"];
  if (typeof digest !== "string" || !DIGEST.test(digest)) return { ok: false, code: "host_error" };
  const actions: Obj[] = [];
  for (const action of Array.isArray(output["actions"]) ? output["actions"].slice(0, MAX_ACTIONS) : []) {
    if (!isObj(action)) continue;
    if (action["kind"] === "move" && typeof action["from"] === "string" && typeof action["to"] === "string") actions.push({ kind: "move", from: shown(action["from"]), to: shown(action["to"]) });
    else if (action["kind"] === "discard" && typeof action["path"] === "string") actions.push({ kind: "discard", from: shown(action["path"]), to: null });
  }
  const applied = output["appliedBy"];
  return {
    ok: true,
    runId: typeof output["runId"] === "string" && RUN_ID.test(output["runId"]) ? output["runId"] : null,
    status: output["status"] === "applied" ? "applied" : "pending",
    digest,
    actions,
    inventoryLimitReached: output["inventoryLimitReached"] === true,
    appliedBy: isObj(applied) && typeof applied["runId"] === "string" && RUN_ID.test(applied["runId"]) && typeof applied["at"] === "string" ? { runId: applied["runId"], at: applied["at"] } : null,
  };
}

/** `review` → `{ok, runId, verdict, replaced}` or a failure. */
export function reviewValue(outcome: unknown): Obj | HostFailure {
  const output = outputOf(outcome);
  if (output === null) return failureOf(outcome);
  const verdict = output["verdict"];
  return {
    ok: true,
    runId: typeof output["runId"] === "string" && RUN_ID.test(output["runId"]) ? output["runId"] : null,
    verdict: verdict === "accepted" || verdict === "rejected" ? verdict : null,
    replaced: output["replaced"] === true,
  };
}
