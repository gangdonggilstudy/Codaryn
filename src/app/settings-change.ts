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
 * command that asked a person before each call allowed without asking (U-107, R-79 F-1), a
 * limit raised or removed, a protected path or an integrity path removed, a secret variable no
 * longer masked, a verifier removed, a command verifier added or changed (R-14 L-2), path tokens restored, plan actions allowed, a different API
 * address (top-level or a provider's, GUI F-3), another provider for quick runs (F-3), a profile or
 * workflow definition changed. Narrowing changes need no confirmation.
 * The new text is the config as formatted JSON; the file's own formatting is not kept.
 */

import { createHash } from "node:crypto";
import { API_PROVIDERS, API_PROVIDER_NAMES, mergeWorkflowPolicy, mergeWorkflowVerifiers } from "../contracts/index.js";
import type { ApiProviderName, CodarynConfig, CommandRule, ConfirmableCommandRule, Limits } from "../contracts/index.js";
import { writeConfigAtomic } from "../cli/models.js";
import { configFieldOf, providerSettingsOf } from "../cli/settings.js";
import { quickProvider } from "../cli/task.js";
import { workflowDefinitions } from "../workflows/index.js";
import { appError } from "./errors.js";
import { checkConfigText, loadSettingsFile, policyNarrowingsOf } from "./settings.js";
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

/** The calls a rule matches: executable, arguments prefix, extra arguments (not whether it asks). */
function ruleKey(rule: CommandRule): string {
  return JSON.stringify([rule.executable, rule.argsPrefix, rule.allowExtraArgs]);
}

/** U-74: a rule of the user's settings that asks a person before each call it allows. */
const asks = (rule: CommandRule): boolean => (rule as ConfirmableCommandRule).confirm === true;

/**
 * The command rules' widening; `prefix` names whose (e.g. "workflows.docs.").
 * - A rule matching calls no rule matched before: `command_added` (and `extra_args_allowed` when it
 *   takes extra arguments), whether it asks or not: a run can make calls it could not make before.
 * - U-107 (R-79 F-1): a rule without `confirm` matching calls only an asking rule matched before:
 *   `confirm_removed`. The policy gate allows a call any rule without `confirm` allows, so those
 *   calls now run without a person's answer (the asking rule changed, or a plain copy added).
 * - A rule that asks where a plain one was, or a plain rule kept, widens nothing.
 */
function commandWidening(before: readonly CommandRule[], after: readonly CommandRule[], prefix: string): SettingsWidening[] {
  const plainBefore = new Set(before.filter((rule) => !asks(rule)).map(ruleKey));
  const askingBefore = new Set(before.filter(asks).map(ruleKey));
  const found: SettingsWidening[] = [];
  for (const [index, rule] of after.entries()) {
    const key = ruleKey(rule);
    const field = `${prefix}policy.commands[${index}]`;
    if (plainBefore.has(key)) continue;
    if (askingBefore.has(key)) {
      if (!asks(rule)) found.push({ kind: "confirm_removed", field });
      continue;
    }
    found.push({ kind: "command_added", field });
    if (rule.allowExtraArgs) found.push({ kind: "extra_args_allowed", field });
  }
  return found;
}

const LIMIT_FIELDS = ["maxModelTurns", "maxToolCalls", "maxTotalTokens", "maxDurationMs", "maxRepairAttempts", "maxSameFailures"] as const;

/** A limit raised: higher, or no longer set (the code's absolute bound applies), or a token limit made unlimited. */
function raised(before: number | null | undefined, after: number | null | undefined): boolean {
  if (before === undefined) return false;
  if (after === undefined) return true;
  if (before === null) return false;
  return after === null || after > before;
}

/** The address a run of `provider` sends to with this config (environment variables aside). */
function addressOf(config: CodarynConfig, provider: ApiProviderName): string {
  return providerSettingsOf(config, provider).apiBaseUrl ?? API_PROVIDERS[provider].defaultApiBaseUrl;
}

type PolicyRules = CodarynConfig["policy"];
type VerifierRules = CodarynConfig["verifiers"];

/** The policy checks of the judgment for one set of rules; `prefix` names whose (e.g. "workflows.docs."). */
function policyWidening(before: PolicyRules, after: PolicyRules, prefix: string): SettingsWidening[] {
  const found: SettingsWidening[] = [...commandWidening(before?.commands ?? [], after?.commands ?? [], prefix)];
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
 * The rules of the quick runs of every workflow that has its own (built-in or the config's), as
 * such runs see them, compared before and after. A workflow defined on one side only is
 * `workflow_changed` already.
 * - Policy, DR-41 (GUI F-5, A-8): the definition's policy is merged with the config's
 *   (mergeWorkflowPolicy: protected paths joined, command lines and plan actions only where both
 *   allow), so the merged policies are compared whatever changed. A configured command rule a
 *   workflow's own rules allow widens that workflow's runs; one organize drops does not.
 * - Verifiers, DR-43 (a) (R-31 L-2): a workflow's own verifiers always run and the config's are
 *   added unless their id is one of the workflow's (mergeWorkflowVerifiers), so the merged lists
 *   are compared whatever changed. An empty config list removes none of the workflow's.
 */
function workflowRulesWidening(before: CodarynConfig, after: CodarynConfig): SettingsWidening[] {
  const found: SettingsWidening[] = [];
  const definitionsAfter = workflowDefinitions(after.workflows);
  for (const [id, was] of Object.entries(workflowDefinitions(before.workflows))) {
    const is = definitionsAfter[id];
    if (is === undefined) continue;
    const prefix = `workflows.${id}.`;
    if (was.policy !== undefined || is.policy !== undefined) {
      found.push(...policyWidening(mergeWorkflowPolicy(was.policy, before.policy), mergeWorkflowPolicy(is.policy, after.policy), prefix));
    }
    if ((was.verifiers?.length ?? 0) > 0 || (is.verifiers?.length ?? 0) > 0) {
      found.push(...verifierWidening(mergeWorkflowVerifiers(was.verifiers, before.verifiers), mergeWorkflowVerifiers(is.verifiers, after.verifiers), prefix));
    }
  }
  return found;
}

/** What `after` lets a run do that `before` did not. */
export function wideningOf(before: CodarynConfig, after: CodarynConfig): SettingsWidening[] {
  const found: SettingsWidening[] = [...commandWidening(before.policy?.commands ?? [], after.policy?.commands ?? [], "")];
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
  // GUI F-3, review R-27 I1: where the workspace's text and a provider's key go, as a run reads it
  // (src/cli/settings.ts resolveConnection): each API provider's address in the config (top-level
  // apiBaseUrl, or providers.<name>.apiBaseUrl when that entry is there), else its default. The
  // same address written another way is not a widening. Addresses from environment variables are
  // not in the config file (R-27 I3). Then the provider a quick run uses (the config's `provider`,
  // else anthropic), with the CLI's own rules.
  for (const provider of API_PROVIDER_NAMES) {
    if (addressOf(before, provider) !== addressOf(after, provider)) {
      const holder = providerSettingsOf(after, provider).apiBaseUrl !== undefined ? after : before;
      found.push({ kind: "api_base_url_changed", field: configFieldOf(holder, provider, "apiBaseUrl") });
    }
  }
  if (quickProvider(before) !== quickProvider(after)) found.push({ kind: "provider_changed", field: "provider" });
  if (!same(before.profiles, after.profiles)) found.push({ kind: "profile_changed", field: "profiles" });
  // U-107 (R-79 F-1): a profile's command that asked and no longer asks is named too, besides
  // profile_changed (which every profile change gives).
  for (const [name, profile] of Object.entries(after.profiles ?? {})) {
    const old = before.profiles?.[name];
    if (old === undefined) continue;
    found.push(...commandWidening(old.policy?.commands ?? [], profile.policy?.commands ?? [], `profiles.${name}.`).filter((item) => item.kind === "confirm_removed"));
  }
  // Review R-27 I4: a profile's own provider wins for its quick runs (SP-D10), so a profile that now
  // sends them to another provider says so, besides profile_changed.
  for (const [name, profile] of Object.entries(after.profiles ?? {})) {
    const old = before.profiles?.[name];
    if (profile.provider === undefined && old?.provider === undefined) continue;
    const was = old?.provider ?? quickProvider(before);
    const is = profile.provider ?? quickProvider(after);
    if (was !== is) found.push({ kind: "provider_changed", field: `profiles.${name}.provider` });
  }
  if (!same(before.workflows, after.workflows)) found.push({ kind: "workflow_changed", field: "workflows" });
  // A workflow's entry that only repeats a config entry (same kind, same field without the
  // workflow's prefix and the list index) is left out: the workflow's runs widen in the way the
  // config's entry already says. What a workflow drops is in the narrowings (policyNarrowingsOf).
  const general = (field: string): string => field.replace(/^workflows\.[^.]+\./, "").replace(/\[\d+\]/g, "");
  const said = new Set(found.map((item) => `${item.kind} ${general(item.field)}`));
  found.push(...workflowRulesWidening(before, after).filter((item) => !said.has(`${item.kind} ${general(item.field)}`)));
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
      // DR-41: what each workflow's own rules would leave out of the new config's policy.
      policyNarrowings: policyNarrowingsOf(prepared.after),
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
