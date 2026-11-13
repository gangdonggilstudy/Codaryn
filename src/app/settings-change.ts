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
 * workflow definition changed, U-183 (DR-69 B-4): a list of writable paths with an entry it did not
 * have (V-8 M-1: even one inside an old entry, which a link can point elsewhere), or that is gone
 * (no limit). U-204 (DR-69 bundle A, A-7, R-7): a list of unreadable paths without an entry it had,
 * or a lower group size k (the config's, or a profile's or a workflow's own raise). Narrowing
 * changes need no confirmation.
 * The new text is the config as formatted JSON; the file's own formatting is not kept.
 */

import { createHash } from "node:crypto";
import { API_PROVIDERS, API_PROVIDER_NAMES, effectiveMinGroupSize, mergeWorkflowPolicy, mergeWorkflowVerifiers } from "../contracts/index.js";
import type { ApiProviderName, CodarynConfig, CommandRule, ConfirmableCommandRule, Limits } from "../contracts/index.js";
import { writeConfigAtomic } from "../cli/models.js";
import { configFieldOf, providerSettingsOf } from "../cli/settings.js";
import { quickProvider } from "../cli/task.js";
import { compilePathSet } from "../policy/path-set.js";
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

/** The separators the policy gate splits an entry on (path-set.ts: `\` too on Windows). */
const ENTRY_SEPARATORS = process.platform === "win32" ? /[\\/]/ : /\//;

/** An entry as the relative path the gate's matcher takes: "/" separated, "." for the root. */
function asRelative(entry: string): string {
  const segments = entry.split(ENTRY_SEPARATORS).filter((segment) => segment !== "" && segment !== ".");
  return segments.length === 0 ? "." : segments.join("/");
}

/**
 * U-183 (DR-69 B-4): one list of writable paths, `field` naming it. Absent is no limit; a list is
 * an allow list where an entry covers itself and everything below it, and a run's write must be
 * covered by every source's list (the config's, the applied profile's, the workflow definition's,
 * the task file's), so each list is judged on its own.
 * - The list gone (no limit again): `writable_paths_unlimited` at the list.
 * - V-8 M-1: an entry that is not one of the old entries, by the policy gate's own matching
 *   (compilePathSet `exact`: whole segments, `\` too and ignoring case on Windows, a trailing `/`
 *   or `./` left out): `writable_path_added` at that entry, even one inside an old entry. The gate
 *   resolves an allow entry to its real path, so an entry narrower by its letters (`a` -> `a/b`)
 *   opens a new scope where `a/b` is a link or junction to elsewhere. These lists are used in
 *   every workspace, each with its own links, so that cannot be checked when the settings change:
 *   what cannot be checked is a widening. (An old list the gate cannot use matched no entry.)
 * - Narrowing: no list before (no limit: a list in any workspace covers less), the same entries in
 *   another order or spelling, an entry removed, an empty list.
 */
function writableWidening(before: readonly string[] | undefined, after: readonly string[] | undefined, field: string): SettingsWidening[] {
  if (before === undefined) return [];
  if (after === undefined) return [{ kind: "writable_paths_unlimited", field }];
  const kept = compilePathSet(before, { match: "exact", onUnusable: "misses" });
  const found: SettingsWidening[] = [];
  for (const [index, entry] of after.entries()) {
    if (typeof entry !== "string" || !kept.covers(asRelative(entry))) found.push({ kind: "writable_path_added", field: `${field}[${index}]` });
  }
  return found;
}

/**
 * U-204 (DR-69 bundle A, A-7, R-7): one list of unreadable paths, `field` naming it. A deny list
 * that only adds up: a run is refused under every entry of the config's, the applied profile's, the
 * workflow definition's and the task file's lists (the union), an entry judged on its text and on
 * its real path (protectedPaths' rule, compilePathSet `onUnusable: "covers"`).
 * - An old entry the new list does not have, by its text or by the gate's matching (compilePathSet
 *   `exact`: whole segments, `\` too and ignoring case on Windows, a trailing `/` or `./` left out),
 *   and `kept` does not have either: `unreadable_path_removed` at the list, once. `kept` is the
 *   config's new list for a profile's or a definition's list: their runs keep its entries.
 * - That holds where a broader entry now stands (`a/b` -> `a`): the gate resolves a deny entry to
 *   its real path, so where `a/b` is a link or junction it denied a target `a` does not cover. These
 *   lists are used in every workspace, each with its own links, so that cannot be checked when the
 *   settings change: what cannot be checked is a widening (as V-8 M-1 for writable paths).
 * - The list gone or empty takes all its entries away.
 * - Narrowing: an entry added, a new list, the same entries in another order or spelling. (A new
 *   list the gate cannot use covers everything, but the old entries it does not have by text are
 *   still named: the parsers refuse such a list.)
 */
function unreadableWidening(
  before: readonly string[] | undefined,
  after: readonly string[] | undefined,
  field: string,
  kept: readonly string[] = [],
): SettingsWidening[] {
  if (before === undefined || before.length === 0) return [];
  const textual = new Set<unknown>([...(after ?? []), ...kept]);
  const sets = [after ?? [], kept].map((list) => compilePathSet(list, { match: "exact", onUnusable: "misses" }));
  const stays = (entry: unknown): boolean => textual.has(entry) || (typeof entry === "string" && sets.some((set) => set.covers(asRelative(entry))));
  return before.every(stays) ? [] : [{ kind: "unreadable_path_removed", field }];
}

/**
 * U-204 (A-7, R-7, Q-4, DR-70): a profile's or a workflow definition's own k. A run's k is the
 * largest of 5 and every source's value (effectiveMinGroupSize; never below 5 since V-12 M-1), so
 * this source can only raise what the config's value gives. Both sides are judged with the config's
 * new value, so a change of the config's own k is said once, at the config: `min_group_size_lowered`
 * at `field` when the runs it applies to would now have a lower k by this source's change alone. A
 * value at or below the config's (or 5) raised nothing, so removing it lowers nothing.
 */
function ownRaiseLowered(base: number | undefined, before: number | undefined, after: number | undefined, field: string): SettingsWidening[] {
  return effectiveMinGroupSize(base, [after]) < effectiveMinGroupSize(base, [before]) ? [{ kind: "min_group_size_lowered", field }] : [];
}

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
  found.push(...writableWidening(before.policy?.writablePaths, after.policy?.writablePaths, "policy.writablePaths"));
  // U-204 (A-7, R-7): the config's unreadable paths, and its k as the runs get it (never below 5,
  // DR-70): lower is a widening, so is a value above 5 taken away; a value below 5 counts as 5.
  found.push(...unreadableWidening(before.policy?.unreadablePaths, after.policy?.unreadablePaths, "policy.unreadablePaths"));
  if (effectiveMinGroupSize(after.policy?.minGroupSize, []) < effectiveMinGroupSize(before.policy?.minGroupSize, [])) {
    found.push({ kind: "min_group_size_lowered", field: "policy.minGroupSize" });
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
  // U-107 (R-79 F-1), U-117 (R-85 L1): a profile's own command rules, besides profile_changed (which
  // every profile change gives), compared with the commands its runs had before: its own policy, or
  // the config's when it had none (a profile without a policy runs with the config's, config-file.ts
  // `profile.policy ?? config.policy`). A question gone is confirm_removed, a new command
  // command_added. A profile left without a policy of its own runs with the config's policy; that
  // change is profile_changed only (the config's entries judge the config's policy itself).
  for (const [name, profile] of Object.entries(after.profiles ?? {})) {
    const old = before.profiles?.[name];
    if (old === undefined || profile.policy === undefined) continue;
    found.push(...commandWidening((old.policy ?? before.policy)?.commands ?? [], profile.policy.commands ?? [], `profiles.${name}.`));
  }
  // U-183 (B-4): a profile's own writablePaths is one more list its runs must satisfy, besides the
  // config's, so it is judged as that profile's list. A profile whose policy is gone has no list of
  // its own any more; a profile removed is profile_changed only.
  for (const [name, old] of Object.entries(before.profiles ?? {})) {
    const profile = after.profiles?.[name];
    if (profile === undefined) continue;
    found.push(...writableWidening(old.policy?.writablePaths, profile.policy?.writablePaths, `profiles.${name}.policy.writablePaths`));
    // U-204 (A-7): a profile's unreadable paths add to the config's and its k only raises the
    // config's, so what it takes away is judged with the config's new list and new k.
    found.push(...unreadableWidening(old.policy?.unreadablePaths, profile.policy?.unreadablePaths, `profiles.${name}.policy.unreadablePaths`, after.policy?.unreadablePaths));
    found.push(...ownRaiseLowered(after.policy?.minGroupSize, old.policy?.minGroupSize, profile.policy?.minGroupSize, `profiles.${name}.policy.minGroupSize`));
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
  // U-183 (B-4): a workflow definition's writablePaths is its own list (mergeWorkflowPolicy does not
  // combine the lists), so it is judged as that workflow's even when the config's list changed alike.
  const definitionsAfter = workflowDefinitions(after.workflows);
  for (const [id, was] of Object.entries(workflowDefinitions(before.workflows))) {
    const is = definitionsAfter[id];
    if (is === undefined) continue;
    found.push(...writableWidening(was.policy?.writablePaths, is.policy?.writablePaths, `workflows.${id}.policy.writablePaths`));
    // U-204 (A-7): a definition's unreadable paths are joined with the config's (mergeWorkflowPolicy,
    // the run's union) and its k is one more source of the run's (effectiveMinGroupSize), so the
    // definition's own are judged as a profile's.
    found.push(...unreadableWidening(was.policy?.unreadablePaths, is.policy?.unreadablePaths, `workflows.${id}.policy.unreadablePaths`, after.policy?.unreadablePaths));
    found.push(...ownRaiseLowered(after.policy?.minGroupSize, was.policy?.minGroupSize, is.policy?.minGroupSize, `workflows.${id}.policy.minGroupSize`));
  }
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
