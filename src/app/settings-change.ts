/**
 * Settings change for the GUI (standalone-gui 3.6, 5.2; UX 7): propose, then apply.
 *
 * - The GUI sends the whole new config (a JSON value it built from the person's edits).
 * - Propose: the same checks as reading a config file (settings.ts: key checks, JSON, parseConfig
 *   with positions), then which fields change and which changes widen what a run may do. Writes
 *   nothing.
 * - Apply: the same checks again, the file must still be what the proposal saw (`baseDigest`), a
 *   widening change needs `confirmWidening` (the GUI's main process asks the person first), and the
 *   file is replaced atomically with the CLI's writer (`writeConfigAtomic`, as `models --use`),
 *   which refuses again if the file changed in between.
 *
 * Widening (UX 7, M-9): a command allowed that was not, any command allowed with extra arguments, a
 * limit raised or removed, a protected path or an integrity path removed, a secret variable no
 * longer masked, a verifier removed, a command verifier added or changed (R-14 L-2), path tokens restored, plan actions allowed, a different API
 * address (top-level or a provider's, GUI F-3), another provider for quick runs (F-3), a profile or
 * workflow definition changed. Narrowing changes need no confirmation.
 * The new text is the config as formatted JSON; the file's own formatting is not kept.
 */

import { createHash } from "node:crypto";
import { API_PROVIDER_NAMES } from "../contracts/index.js";
import type { CodarynConfig, CommandRule, Limits } from "../contracts/index.js";
import { writeConfigAtomic } from "../cli/models.js";
import { configFieldOf, providerSettingsOf } from "../cli/settings.js";
import { quickProvider } from "../cli/task.js";
import { workflowDefinitions } from "../workflows/index.js";
import { appError } from "./errors.js";
import { checkConfigText, loadSettingsFile } from "./settings.js";
import type { ChosenFile, SettingsIo } from "./settings.js";
import type {
  AppCallOutcome,
  ApplySettingsChangeRequest,
  SettingsChangeProposal,
  SettingsChangeRequest,
  SettingsFieldChange,
  SettingsWidening,
  SettingsWritten,
} from "./types.js";

export function digestOf(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function ruleKey(rule: CommandRule): string {
  return JSON.stringify([rule.executable, rule.argsPrefix, rule.allowExtraArgs]);
}

const LIMIT_FIELDS = ["maxModelTurns", "maxToolCalls", "maxTotalTokens", "maxDurationMs", "maxRepairAttempts", "maxSameFailures"] as const;

/** A limit raised: higher, or no longer set (the code's absolute bound applies), or a token limit made unlimited. */
function raised(before: number | null | undefined, after: number | null | undefined): boolean {
  if (before === undefined) return false;
  if (after === undefined) return true;
  if (before === null) return false;
  return after === null || after > before;
}

type PolicyRules = CodarynConfig["policy"];
type VerifierRules = CodarynConfig["verifiers"];

/** The policy checks of the judgment for one set of rules; `prefix` names whose (e.g. "workflows.docs."). */
function policyWidening(before: PolicyRules, after: PolicyRules, prefix: string): SettingsWidening[] {
  const found: SettingsWidening[] = [];
  const oldRules = new Set((before?.commands ?? []).map(ruleKey));
  for (const [index, rule] of (after?.commands ?? []).entries()) {
    if (oldRules.has(ruleKey(rule))) continue;
    found.push({ kind: "command_added", field: `${prefix}policy.commands[${index}]` });
    if (rule.allowExtraArgs) found.push({ kind: "extra_args_allowed", field: `${prefix}policy.commands[${index}]` });
  }
  const newProtected = new Set(after?.protectedPaths ?? []);
  if ((before?.protectedPaths ?? []).some((entry) => !newProtected.has(entry))) found.push({ kind: "protected_path_removed", field: `${prefix}policy.protectedPaths` });
  if (before?.restorePathTokens !== true && after?.restorePathTokens === true) found.push({ kind: "restore_path_tokens_enabled", field: `${prefix}policy.restorePathTokens` });
  const oldActions = new Set(before?.planActions ?? []);
  if ((after?.planActions ?? []).some((action) => !oldActions.has(action))) found.push({ kind: "plan_action_allowed", field: `${prefix}policy.planActions` });
  return found;
}

/** The verifier checks of the judgment for one set of rules (R-14 L-2 for command verifiers). */
function verifierWidening(before: VerifierRules, after: VerifierRules, prefix: string): SettingsWidening[] {
  const found: SettingsWidening[] = [];
  const oldVerifiers = new Set((before ?? []).map((verifier) => JSON.stringify(verifier)));
  const newVerifiers = new Set((after ?? []).map((verifier) => JSON.stringify(verifier)));
  if ((before ?? []).some((verifier) => !newVerifiers.has(JSON.stringify(verifier)))) found.push({ kind: "verifier_removed", field: `${prefix}verifiers` });
  for (const [index, verifier] of (after ?? []).entries()) {
    if (verifier.kind === "command" && !oldVerifiers.has(JSON.stringify(verifier))) found.push({ kind: "verifier_command_added", field: `${prefix}verifiers[${index}]` });
  }
  return found;
}

/**
 * GUI F-5: in the quick form a workflow's own policy and verifiers apply only while the config has
 * none (src/cli/run.ts `underDefinition`: `config.policy ?? definition.policy`, the same for
 * verifiers). When the config's `policy` or `verifiers` appears or goes, the rules of every workflow
 * that has its own (built-in or the config's) change, so they are compared as such runs see them.
 * A workflow defined on one side only is `workflow_changed` already.
 */
function workflowRulesWidening(before: CodarynConfig, after: CodarynConfig): SettingsWidening[] {
  const policyMoves = (before.policy === undefined) !== (after.policy === undefined);
  const verifiersMove = (before.verifiers === undefined) !== (after.verifiers === undefined);
  if (!policyMoves && !verifiersMove) return [];
  const found: SettingsWidening[] = [];
  const definitionsAfter = workflowDefinitions(after.workflows);
  for (const [id, was] of Object.entries(workflowDefinitions(before.workflows))) {
    const is = definitionsAfter[id];
    if (is === undefined) continue;
    const prefix = `workflows.${id}.`;
    if (policyMoves && (was.policy !== undefined || is.policy !== undefined)) {
      found.push(...policyWidening(before.policy ?? was.policy, after.policy ?? is.policy, prefix));
    }
    if (verifiersMove && (was.verifiers !== undefined || is.verifiers !== undefined)) {
      found.push(...verifierWidening(before.verifiers ?? was.verifiers, after.verifiers ?? is.verifiers, prefix));
    }
  }
  return found;
}

/** What `after` lets a run do that `before` did not. */
export function wideningOf(before: CodarynConfig, after: CodarynConfig): SettingsWidening[] {
  const found: SettingsWidening[] = [];
  const oldRules = new Set((before.policy?.commands ?? []).map(ruleKey));
  for (const [index, rule] of (after.policy?.commands ?? []).entries()) {
    if (!oldRules.has(ruleKey(rule))) found.push({ kind: "command_added", field: `policy.commands[${index}]` });
    if (rule.allowExtraArgs && !oldRules.has(ruleKey(rule))) found.push({ kind: "extra_args_allowed", field: `policy.commands[${index}]` });
  }
  const oldLimits: Partial<Limits> = before.limits ?? {};
  const newLimits: Partial<Limits> = after.limits ?? {};
  for (const field of LIMIT_FIELDS) {
    if (raised(oldLimits[field], newLimits[field])) found.push({ kind: "limit_raised", field: `limits.${field}` });
  }
  const newProtected = new Set(after.policy?.protectedPaths ?? []);
  for (const entry of before.policy?.protectedPaths ?? []) {
    if (!newProtected.has(entry)) found.push({ kind: "protected_path_removed", field: "policy.protectedPaths" });
  }
  const newIntegrity = new Set(after.integrity?.paths ?? []);
  for (const entry of before.integrity?.paths ?? []) {
    if (!newIntegrity.has(entry)) found.push({ kind: "integrity_path_removed", field: "integrity.paths" });
  }
  const newSecrets = new Set(after.secretEnv ?? []);
  for (const name of before.secretEnv ?? []) {
    if (!newSecrets.has(name)) found.push({ kind: "secret_env_removed", field: "secretEnv" });
  }
  const newVerifiers = new Set((after.verifiers ?? []).map((verifier) => JSON.stringify(verifier)));
  for (const verifier of before.verifiers ?? []) {
    if (!newVerifiers.has(JSON.stringify(verifier))) found.push({ kind: "verifier_removed", field: "verifiers" });
  }
  // R-14 L-2: a command verifier runs with the person's rights on every run, so one that is new or
  // changed widens what a run does. A file rule verifier only checks more.
  const oldVerifiers = new Set((before.verifiers ?? []).map((verifier) => JSON.stringify(verifier)));
  for (const [index, verifier] of (after.verifiers ?? []).entries()) {
    if (verifier.kind === "command" && !oldVerifiers.has(JSON.stringify(verifier))) {
      found.push({ kind: "verifier_command_added", field: `verifiers[${index}]` });
    }
  }
  if (before.policy?.restorePathTokens !== true && after.policy?.restorePathTokens === true) {
    found.push({ kind: "restore_path_tokens_enabled", field: "policy.restorePathTokens" });
  }
  const oldActions = new Set(before.policy?.planActions ?? []);
  for (const action of after.policy?.planActions ?? []) {
    if (!oldActions.has(action)) found.push({ kind: "plan_action_allowed", field: "policy.planActions" });
  }
  if (!same(before.apiBaseUrl, after.apiBaseUrl)) found.push({ kind: "api_base_url_changed", field: "apiBaseUrl" });
  // GUI F-3: where the workspace's text and a provider's key go. Each API provider's address as a
  // run reads it (top-level apiBaseUrl, or providers.<name>.apiBaseUrl), and the provider a quick
  // run uses (the config's `provider`, else anthropic), with the CLI's own rules.
  for (const provider of API_PROVIDER_NAMES) {
    if (!same(providerSettingsOf(before, provider).apiBaseUrl, providerSettingsOf(after, provider).apiBaseUrl)) {
      const holder = providerSettingsOf(after, provider).apiBaseUrl !== undefined ? after : before;
      found.push({ kind: "api_base_url_changed", field: configFieldOf(holder, provider, "apiBaseUrl") });
    }
  }
  if (quickProvider(before) !== quickProvider(after)) found.push({ kind: "provider_changed", field: "provider" });
  if (!same(before.profiles, after.profiles)) found.push({ kind: "profile_changed", field: "profiles" });
  if (!same(before.workflows, after.workflows)) found.push({ kind: "workflow_changed", field: "workflows" });
  found.push(...workflowRulesWidening(before, after));
  // One entry per kind and field.
  const seen = new Set<string>();
  return found.filter((item) => {
    const key = `${item.kind} ${item.field}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Fields that differ, one level down inside `policy` and `limits`. */
export function changesOf(before: CodarynConfig, after: CodarynConfig): SettingsFieldChange[] {
  const out: SettingsFieldChange[] = [];
  const compare = (prefix: string, a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>, deeper: readonly string[]): void => {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    for (const key of keys) {
      const field = prefix === "" ? key : `${prefix}.${key}`;
      const had = Object.hasOwn(a, key) && a[key] !== undefined;
      const has = Object.hasOwn(b, key) && b[key] !== undefined;
      if (had && has && deeper.includes(key) && typeof a[key] === "object" && typeof b[key] === "object" && a[key] !== null && b[key] !== null) {
        compare(field, a[key] as Record<string, unknown>, b[key] as Record<string, unknown>, []);
        continue;
      }
      if (!had && has) out.push({ field, change: "added" });
      else if (had && !has) out.push({ field, change: "removed" });
      else if (had && has && !same(a[key], b[key])) out.push({ field, change: "changed" });
    }
  };
  compare("", before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, ["policy", "limits"]);
  return out;
}

type Prepared =
  | {
      readonly ok: true;
      readonly file: ChosenFile;
      readonly raw: string;
      readonly text: string;
      readonly before: CodarynConfig;
      readonly after: CodarynConfig;
    }
  | { readonly ok: false; readonly error: ReturnType<typeof appError> };

/** The current file and the checked new config. The file must exist: create it first (`createSettings`). */
async function prepare(io: SettingsIo, request: SettingsChangeRequest): Promise<Prepared> {
  const loaded = await loadSettingsFile(io, request.configPath);
  if (!loaded.ok) return loaded;
  if (loaded.file === null || loaded.raw === null || loaded.config === null) {
    return { ok: false, error: appError("invalid_config", "there is no config file to change; create it first") };
  }
  let text: string;
  try {
    const serialized = JSON.stringify(request.next, null, 2);
    if (typeof serialized !== "string") throw new Error("not JSON");
    text = `${serialized}\n`;
  } catch {
    return { ok: false, error: appError("invalid_config", "the new settings are not a JSON value") };
  }
  const checked = checkConfigText(text, loaded.currentKey);
  if (!checked.ok) return checked;
  return { ok: true, file: loaded.file, raw: loaded.raw, text, before: loaded.config, after: checked.config };
}

export async function proposeSettingsChangeIn(io: SettingsIo, request: SettingsChangeRequest): Promise<AppCallOutcome<SettingsChangeProposal>> {
  const prepared = await prepare(io, request);
  if (!prepared.ok) return prepared;
  return {
    ok: true,
    output: {
      kind: "settings_change",
      file: prepared.file,
      baseDigest: digestOf(prepared.raw),
      digest: digestOf(prepared.text),
      changes: changesOf(prepared.before, prepared.after),
      widening: wideningOf(prepared.before, prepared.after),
      config: prepared.after,
    },
  };
}

export async function applySettingsChangeIn(
  io: SettingsIo,
  request: ApplySettingsChangeRequest,
  write: typeof writeConfigAtomic = writeConfigAtomic,
): Promise<AppCallOutcome<SettingsWritten>> {
  const prepared = await prepare(io, request);
  if (!prepared.ok) return prepared;
  if (digestOf(prepared.raw) !== request.baseDigest) {
    return { ok: false, error: appError("config_write_failed", "the config file changed since the change was proposed; nothing was written") };
  }
  const widening = wideningOf(prepared.before, prepared.after);
  if (widening.length > 0 && request.confirmWidening !== true) {
    return { ok: false, error: appError("invalid_arguments", "the change widens what runs may do; it is written only when the person confirmed it") };
  }
  const changes = changesOf(prepared.before, prepared.after);
  if (changes.length === 0) {
    return { ok: true, output: { kind: "settings_written", file: prepared.file, written: false, digest: digestOf(prepared.raw), changes, widening } };
  }
  try {
    await write(prepared.file.path, prepared.text, { exclusive: false, expected: prepared.raw });
  } catch {
    return { ok: false, error: appError("config_write_failed", "the config file could not be written, or it changed meanwhile; it was left as it was") };
  }
  return { ok: true, output: { kind: "settings_written", file: prepared.file, written: true, digest: digestOf(prepared.text), changes, widening } };
}
