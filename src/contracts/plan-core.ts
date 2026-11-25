/** Common plan actions, masking and consent contracts. Re-exported by plan.ts. */

import { PRIVACY_TOKEN_PATTERN_SOURCE } from "./text.js";
import type { ContentHash, MaskedText } from "./text.js";
import type { ToolDescriptor } from "./tool.js";

/**
 * How a task treats a plan. `none`: no plan step, as before stage 4. `apply`: a person approves
 * moves and discards that an apply run carries out without a model (above). `run` (P1, DR-69,
 * B-1): a person approves the files a model may write (StoredChangesPlan), and a later model run
 * writes those files only. A plan run offers the read tools and its own mode's plan tool
 * (ToolDescriptor.planMode): `propose_changes` (U-180, B-3) for `run`. A plan run whose task does
 * not list it reads, ends without a plan (`failed`/`model_error`) and writes nothing.
 */
export const PLAN_MODES = ["none", "apply", "run"] as const;
export type PlanMode = (typeof PLAN_MODES)[number];

/**
 * What a plan may do. `move` renames a file inside the workspace. `discard` moves a file into
 * DISCARDED_DIR_NAME, where `codaryn revert` can bring it back; nothing is deleted (GT-D5). A kind
 * runs only when `PolicyConfig.planActions` lists it.
 */
export const PLAN_ACTION_KINDS = ["move", "discard"] as const;
export type PlanActionKind = (typeof PLAN_ACTION_KINDS)[number];

/** Most actions in one plan. More is `invalid_plan` (`too_many`). */
export const MAX_PLAN_ACTIONS = 1000;
/**
 * Most bytes of source files in one plan, summed (4 GiB). Every source is hashed when the plan is
 * proposed, again before it is applied, and its target once more by the inventory check. More is
 * `invalid_plan` (`too_large`), found before anything is stored.
 */
export const MAX_PLAN_SOURCE_BYTES = 4 * 1024 * 1024 * 1024;
/** Longest `propose_plan.summary`, in characters. */
export const MAX_PLAN_SUMMARY_CHARS = 500;
/** Shortest digest prefix `apply --digest` accepts, in lowercase hex characters. */
export const MIN_PLAN_DIGEST_PREFIX = 12;

/** `<root>/.codaryn/runs/<plan runId>/plan.json`: the stored plan (StoredPlan). Written once. */
export const PLAN_FILE_NAME = "plan.json";
/**
 * `<root>/.codaryn/runs/<plan runId>/applied.json` (PlanAppliedRecord): written exclusively by the
 * apply run after its preflight passed and before its first action. Its presence makes a plan
 * applied: a second apply stops as `plan_already_applied`.
 * DR-24 (c): plan.json and applied.json are created exclusively also on a drive without hard links
 * (for example by an exclusive-create open), so a plan run and the DR-21 consent path work there.
 * They are new files, not moves: no consent is involved.
 */
export const PLAN_APPLIED_FILE_NAME = "applied.json";
/**
 * DR-9: `<root>/.codaryn/discarded/<apply runId>/` holds the files a `discard` action set aside.
 * It lies outside the run directories, so deleting a run's records never deletes these files.
 * Removing them is a separate step that shows their number and size and asks on its own.
 */
export const DISCARDED_DIR_NAME = "discarded";

/** An action as the model proposes it. Paths are relative to the workspace root, `/` or `\` separated. */
export type PlanActionArgs =
  | { readonly kind: "move"; readonly from: string; readonly to: string }
  | { readonly kind: "discard"; readonly path: string };

/** Arguments of `propose_plan`. */
export interface ProposePlanArgs {
  /**
   * One line for people, at most MAX_PLAN_SUMMARY_CHARS. Masked and recorded with the tool call;
   * not part of plan.json, so it is not what a person approves.
   */
  readonly summary: string;
  /** 1 to MAX_PLAN_ACTIONS actions, applied in this order. */
  readonly actions: readonly PlanActionArgs[];
}

/**
 * An action after every check: paths are relative to the workspace root, `/` separated, with links
 * resolved and permitted tokens restored. `sha256` is the source file's SHA-256 as the tool read it
 * when the plan was proposed; the model never supplies it. Local text: masked before it is
 * recorded, sent or shown.
 */
export type ResolvedPlanAction =
  | { readonly kind: "move"; readonly from: string; readonly to: string; readonly sha256: ContentHash }
  | { readonly kind: "discard"; readonly path: string; readonly sha256: ContentHash };

/** The masked form, as results and PlanOutput hold it. */
export type MaskedPlanAction =
  | { readonly kind: "move"; readonly from: MaskedText; readonly to: MaskedText; readonly sha256: ContentHash }
  | { readonly kind: "discard"; readonly path: MaskedText; readonly sha256: ContentHash };

/**
 * Why `propose_plan` rejects a plan (tool error `invalid_plan`; the message names the action index
 * and this code, never a path). Nothing is stored.
 * - empty, too_many: no action, or more than MAX_PLAN_ACTIONS
 * - too_large: the sources sum to more than MAX_PLAN_SOURCE_BYTES (index of the action that passed it)
 * - same_path: a move whose `from` and `to` are the same file
 * - duplicate_source: a path is the source of more than one action
 * - duplicate_destination: two moves have the same `to`
 * - destination_is_source: a `to` is another action's source (chains and swaps are refused)
 * - source_missing, source_not_file: the source does not exist, or is not a regular file
 *   (directories are moved file by file; links are not moved)
 * - destination_exists: something exists at `to`
 * - destination_parent_not_dir: a parent of `to` exists and is not a directory
 */
export const PLAN_PROBLEMS = [
  "empty",
  "too_many",
  "too_large",
  "same_path",
  "duplicate_source",
  "duplicate_destination",
  "destination_is_source",
  "source_missing",
  "source_not_file",
  "destination_exists",
  "destination_parent_not_dir",
] as const;
export type PlanProblem = (typeof PLAN_PROBLEMS)[number];

/**
 * What `propose_plan` returns when the plan was stored. The engine masks it before recording it
 * (`tool_result`) or returning it to the model, and then ends the run as `plan_pending` with
 * `EngineResult.plan` taken from it.
 */
export interface ProposePlanPayload {
  /** PlanRecorder.savePlan's result: the SHA-256 of plan.json's bytes. */
  readonly digest: ContentHash;
  readonly actions: readonly ResolvedPlanAction[];
}

/**
 * Synthetic descriptors for judging one plan action with the policy gate, when the plan is proposed
 * and again in the apply's preflight. They are not tools: their names are not tool names, so the
 * gate takes their requirements as given (`createPolicyGate`). Every path is a write: a move
 * changes both places and a discard removes the file. `planAction` asks the gate to check
 * `PolicyConfig.planActions` (denial `destructive`/`plan_action_not_allowed`).
 */
export const PLAN_ACTION_DESCRIPTORS: { readonly [K in PlanActionKind]: ToolDescriptor } = {
  move: {
    name: "plan.move",
    displayClass: "write-local",
    requires: {
      paths: [
        { field: "from", access: "write" },
        { field: "to", access: "write" },
      ],
      command: false,
      network: false,
      destructive: false,
      planAction: "move",
    },
    restoreFields: ["from", "to"],
    documentFields: [],
  },
  discard: {
    name: "plan.discard",
    displayClass: "write-local",
    requires: {
      paths: [{ field: "path", access: "write" }],
      command: false,
      network: false,
      destructive: false,
      planAction: "discard",
    },
    restoreFields: ["path"],
    documentFields: [],
  },
};

/**
 * DR-28 (R-11 M-1): a masked text's visible parts, the text split at every privacy token
 * (PRIVACY_TOKEN_PATTERN_SOURCE) with the tokens left out: `[[CODARYN_SECRET:…]]/a.jpg` gives
 * `["", "/a.jpg"]`, two tokens in a row give an empty part between them, and a text without a
 * token gives `[text]`. Token ids are random in every run, the parts are not: two maskings of the
 * same path have the same parts exactly when they leave the same text visible. It holds no secret
 * value and no hash of one.
 */
export type MaskedParts = readonly string[];

/** DR-28: an action's paths as the plan run masked them, as visible parts. */
export type PlanActionShown =
  | { readonly from: MaskedParts; readonly to: MaskedParts }
  | { readonly path: MaskedParts };

/** DR-28: `masked` split into its visible parts (MaskedParts). */
export function maskedParts(masked: string): MaskedParts {
  return masked.split(new RegExp(PRIVACY_TOKEN_PATTERN_SOURCE));
}

/**
 * DR-32 (c): the exact text whose SHA-256 is the digest of a visible-part list: the list as JSON
 * (`JSON.stringify`), hashed as UTF-8 bytes, written as 64 lowercase hex characters. Each side that
 * needs a digest computes it with its own SHA-256 from this text, so all of them agree; the
 * contracts hash nothing themselves (they hold no platform module).
 */
export function maskedPartsEncoding(parts: MaskedParts): string {
  return JSON.stringify(parts);
}

/** DR-28, DR-29: true when two visible-part lists are the same, part by part. */
export function sameMaskedParts(a: MaskedParts, b: MaskedParts): boolean {
  return a.length === b.length && a.every((part, i) => part === b[i]);
}

/** DR-28: the shown form of an action masked by the plan run's gateway, stored with the action. */
export function planActionShown(masked: MaskedPlanAction): PlanActionShown {
  return masked.kind === "move"
    ? { from: maskedParts(masked.from), to: maskedParts(masked.to) }
    : { path: maskedParts(masked.path) };
}

/**
 * DR-28: true when `masked`, the stored action masked with the secrets registered now, leaves
 * exactly the text visible that the plan run left visible (`action.shown`). False when the kinds
 * differ, a part differs, or the action has no `shown` (a plan written before DR-28): such a plan
 * is not shown or applied (`plan_secrets_differ`).
 */
export function planActionShownMatches(action: StoredPlanAction, masked: MaskedPlanAction): boolean {
  const shown = action.shown;
  if (shown === undefined || action.kind !== masked.kind) return false;
  const now = planActionShown(masked);
  if ("path" in shown) return "path" in now && sameMaskedParts(shown.path, now.path);
  return "from" in now && sameMaskedParts(shown.from, now.from) && sameMaskedParts(shown.to, now.to);
}

/**
 * A stored action: the resolved action and (DR-28) its paths as the plan run masked them. `shown`
 * is written for every action from DR-28 on; it is optional only so that values built before it
 * still type-check. A plan whose action has none is treated as masked differently.
 */
export type StoredPlanAction =
  | (Extract<ResolvedPlanAction, { readonly kind: "move" }> & {
      readonly shown?: { readonly from: MaskedParts; readonly to: MaskedParts };
    })
  | (Extract<ResolvedPlanAction, { readonly kind: "discard" }> & { readonly shown?: { readonly path: MaskedParts } });

/**
 * plan.json: the actions and their source hashes, nothing else (DR-5), plus (DR-28) each action's
 * masked form as visible parts. No policy, verifier, limit, secret name, secret value or hash of
 * one is stored, so this file inside the workspace cannot decide how the apply runs. Raw local
 * text, like the snapshots (R-8): never sent to a model; shown only masked.
 */
export interface StoredPlan {
  readonly schemaVersion: 1;
  readonly kind: "plan";
  /** The plan run. A file naming another run is `invalid_run_record`. */
  readonly runId: string;
  readonly actions: readonly StoredPlanAction[];
}

/**
 * How the person approved the plan. Recorded in `apply_started`; never who.
 * - cli-tty: the CLI showed the plan at a terminal and the answer was yes
 * - cli-flag: `--digest` matched the stored plan (non-interactive)
 * - adapter: an adapter (VS Code, GUI) opened its plan view after the `plan_pending` result and
 *   passed the approved digest to the app layer's `applyPlan(runId, digest)` (DR-1)
 */
export const APPROVAL_CHANNELS = ["cli-tty", "cli-flag", "adapter"] as const;
export type ApprovalChannel = (typeof APPROVAL_CHANNELS)[number];

/**
 * DR-21: the person's consent to unsafe moves (`unsafe_move`) for one apply. It comes only from a
 * person: the CLI's own argument (UNSAFE_MOVE_CONSENT_ARGUMENT, `cli-flag`) or terminal answer
 * (`cli-tty`) for this one `apply`, or an adapter after the person agreed on screen (`adapter`).
 * No task file, config file, profile, plan or model can give it; there is no such field anywhere
 * and none may be added. It names the digest of the plan it is for and holds for that apply only:
 * a later apply needs it again. It is recorded in `apply_started.unsafeMoveConsent`, and every move
 * made under it is marked `unsafe` in `file_moved` and in the result.
 */
export interface UnsafeMoveConsent {
  readonly channel: ApprovalChannel;
  /** Must equal ApplyDeps.digest; a consent for another plan counts as none. */
  readonly digest: ContentHash;
}

/**
 * DR-24 (a): the name a discarded file gets inside `.codaryn/discarded/<apply runId>/`: the
 * action's 0-based index in decimal, one segment (`String(index)`). Readers accept nothing else.
 */
export const DISCARDED_STORED_NAME_PATTERN_SOURCE = "^(0|[1-9][0-9]{0,5})$";
export function discardedStoredName(index: number): string {
  return String(index);
}

/** DR-21: the CLI argument by which a person consents to unsafe moves for this apply. */
export const UNSAFE_MOVE_CONSENT_ARGUMENT = "--allow-unsafe-move";
