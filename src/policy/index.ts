/**
 * Policy gate: every required permission is judged on its own, before and after restoration.
 * Requirements come from the tool descriptor and the fixed table in the contracts.
 * Nothing in the call arguments or in workspace files can lower them.
 *
 * U-175 (DR-69 B-2): writable paths (PolicyGateOptions.writablePathSets). A write that one of the
 * lists does not cover is denied as `path`/`path_not_writable`. Judged only after links are
 * resolved (checkEffective): for an allow list the text alone decides nothing, since a path that
 * misses every entry's text may still lie under an entry's real path, and one that matches an
 * entry's text may still lead elsewhere through a link below it. A protected path is reported first.
 * Review V-3 M-1: an entry allows only after its own real path was found (path-set.ts, `misses`).
 *
 * U-203 (bundle A, A-3; R-1, R-3, R-5, R-8): unreadable paths (PolicyConfig.unreadablePaths), a
 * deny list judged as the protected paths are (the text first, then the real path; an unusable list
 * or entry covers everything). Under them every access but `aggregate` (query_table) is denied as
 * `path`/`unreadable_path`: a read, a listing's start, a command's cwd and a write (it is a
 * protected path as well), reported before a protected path. With any unreadable entry every
 * command is denied (`command`/`command_not_allowed`): a command can read anything (R-5, which the
 * resolution refuses first, A-6).
 */

import { BUILTIN_TOOLS, PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE, unreadablePathsOf } from "../contracts/index.js";
import type {
  CommandRule,
  CreatePolicyGate,
  PathAccess,
  PermissionKind,
  PolicyDecision,
  PolicyDenialCode,
  ToolDescriptor,
  ToolRequirements,
  WritablePathSet,
} from "../contracts/index.js";
import { noteJudged } from "../workspace/judged.js";
import { lexicalCheck } from "../workspace/lexical.js";
import { compilePathSet } from "./path-set.js";
import type { PathSet } from "./path-set.js";
import { compileProtectedPaths } from "./protected.js";

/** T-13: the single format rule for `protectedPaths`, used by the CLI and by this gate. */
export { checkProtectedPaths } from "./protected.js";
/**
 * U-105 (app layer U-89): the gate's own matcher for `protectedPaths`, for a caller that shows
 * which entries are protected (the app layer's workspace list) with the gate's rule, not a copy.
 */
export { compileProtectedPaths } from "./protected.js";
export type { ProtectedPaths } from "./protected.js";
/**
 * U-187 (p5a request): the path set matcher itself (path-set.ts), for a caller that judges a list of
 * workspace paths with the gate's rule, not a copy: `prefix` or `exact`, a deny list (`covers`) or an
 * allow list (`misses`, an entry allows only once its real path was found).
 */
export { checkPathSetFormat, compilePathSet } from "./path-set.js";
export type { PathSet, PathSetOptions } from "./path-set.js";

type Denial = Extract<PolicyDecision, { allowed: false }>;

const ALLOWED: PolicyDecision = { allowed: true };

/** When several permissions are denied, the first one in this order is reported. */
const REPORT_ORDER: readonly PermissionKind[] = ["path", "command", "network", "destructive", "restore"];

function deny(permission: PermissionKind, code: PolicyDenialCode): Denial {
  return { allowed: false, permission, code };
}

/**
 * U-74 (DR-3): the confirm mark is reported only when it is the only denial; any other denial wins,
 * so what the policy denies outright is never asked.
 */
function decide(denials: readonly Denial[]): PolicyDecision {
  const plain = denials.filter((denial) => denial.confirm !== true);
  for (const permission of REPORT_ORDER) {
    const found = plain.find((denial) => denial.permission === permission);
    if (found !== undefined) {
      return found;
    }
  }
  return denials.find((denial) => denial.confirm === true) ?? ALLOWED;
}

/** U-74: the mark of a command only a `confirm: true` rule of the user's settings allows. */
const CONFIRM_MARK: Denial = { allowed: false, permission: "command", code: "confirmation_required", confirm: true };

/**
 * Requirements of the descriptor. For a built-in tool name the fixed table is merged in,
 * so a descriptor that claims less than the table is still judged by the table.
 */
function requirementsOf(descriptor: ToolDescriptor): ToolRequirements {
  const given = descriptor.requires;
  if (!Object.hasOwn(BUILTIN_TOOLS, descriptor.name)) {
    return given;
  }
  const fixed = BUILTIN_TOOLS[descriptor.name as keyof typeof BUILTIN_TOOLS].requires;
  const paths = [...fixed.paths];
  for (const entry of given.paths) {
    if (!paths.some((known) => known.field === entry.field && known.access === entry.access)) {
      paths.push(entry);
    }
  }
  return {
    paths,
    command: fixed.command || given.command,
    network: fixed.network || given.network,
    destructive: fixed.destructive || given.destructive,
    // No built-in tool is a plan action. A descriptor that claims one is still judged as one.
    ...(given.planAction === undefined ? {} : { planAction: given.planAction }),
  };
}

/** Reads a dot path from the arguments. Only own properties of plain objects are followed. */
function readField(args: unknown, field: string): unknown {
  let value: unknown = args;
  for (const key of field.split(".")) {
    if (typeof value !== "object" || value === null || Array.isArray(value) || !Object.hasOwn(value, key)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function matchesRule(rule: CommandRule, args: readonly string[]): boolean {
  if (args.length < rule.argsPrefix.length) {
    return false;
  }
  if (!rule.allowExtraArgs && args.length !== rule.argsPrefix.length) {
    return false;
  }
  return rule.argsPrefix.every((value, index) => args[index] === value);
}

/**
 * U-175 (B-2, B-4, B-5): one matcher per writable list. A policy's list covers what is below its
 * entries; the approved plan's files cover exactly themselves. Allow lists: an unusable list or
 * entry covers nothing.
 */
function compileWritablePathSets(sets: readonly WritablePathSet[] | undefined): readonly PathSet[] {
  // Review V-11 H-1: the plan's entries are effective paths; they cover only themselves, unlinked.
  return (sets ?? []).map((set) =>
    compilePathSet(set.entries, set.source === "plan" ? { match: "exact", onUnusable: "misses", entryLinks: "refuse" } : { match: "prefix", onUnusable: "misses" }),
  );
}

export const createPolicyGate: CreatePolicyGate = ({ config, workspace, writablePathSets, unreadablePaths }) => {
  const tokenLike = new RegExp(PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE, "i");
  // Only the config decides what is protected. Writes are denied; reads and `cwd` are not.
  const protectedPaths = compileProtectedPaths(config.protectedPaths);
  // U-203 (R-1, R-3): unreadable paths; present at all (even unusable), no command may run (R-5).
  // Review R-102 M-1: the run's own list (PolicyGateOptions.unreadablePaths, every source united),
  // with the policy's list as well, which can only protect more. A value that is not a list makes
  // the whole set unusable: it covers everything.
  const unreadableGiven: readonly unknown[] = [unreadablePaths, config.unreadablePaths];
  const unreadableValue: unknown = unreadableGiven.some((value) => value !== undefined && !Array.isArray(value))
    ? "not a list"
    : unreadablePathsOf(unreadableGiven as readonly (readonly string[] | undefined)[]);
  const unreadable = compilePathSet(unreadableValue, { match: "prefix", onUnusable: "covers" });
  const unreadablePresent = !Array.isArray(unreadableValue) || unreadableValue.length > 0;
  const writable = compileWritablePathSets(writablePathSets);

  /** True when every writable list covers the resolved path (no list: no such limit). */
  async function writableEffective(relative: string): Promise<boolean> {
    for (const set of writable) {
      if (!(await set.coversEffective(relative, workspace))) return false;
    }
    return true;
  }

  function restorableFields(descriptor: ToolDescriptor): readonly string[] {
    return config.restorePathTokens === true ? [...descriptor.restoreFields] : [];
  }

  /**
   * U-74 (DR-3): a command a rule without `confirm` allows is allowed. One that only `confirm: true`
   * rules allow (ConfirmableCommandRule, the user's settings only) passes the first check and gets
   * CONFIRM_MARK from the second, after restoration, where the engine asks.
   */
  function checkCommand(args: unknown, stage: "requested" | "effective"): Denial | null {
    const executable = readField(args, "executable");
    const callArgs = readField(args, "args");
    if (typeof executable !== "string") {
      return deny("command", "command_not_allowed");
    }
    const rules = config.commands.filter((rule) => rule.executable === executable);
    if (rules.length === 0) {
      return deny("command", "command_not_allowed");
    }
    if (!Array.isArray(callArgs) || !callArgs.every((value) => typeof value === "string")) {
      return deny("command", "args_not_allowed");
    }
    const matching = rules.filter((rule) => matchesRule(rule, callArgs));
    if (matching.length === 0) return deny("command", "args_not_allowed");
    if (matching.some((rule) => rule.confirm !== true)) return null;
    return stage === "requested" ? null : CONFIRM_MARK;
  }

  /** Checks that do not depend on paths: command, network, destructive. */
  function checkFixed(requires: ToolRequirements, args: unknown, stage: "requested" | "effective"): Denial[] {
    const denials: Denial[] = [];
    if (requires.command) {
      const denial = unreadablePresent ? deny("command", "command_not_allowed") : checkCommand(args, stage);
      if (denial !== null) {
        denials.push(denial);
      }
    }
    // Phase 1a has no "allow" value for these two. Anything that requires them is denied.
    if (requires.network) {
      denials.push(deny("network", "network_denied"));
    }
    if (requires.destructive) {
      denials.push(deny("destructive", "destructive_denied"));
    }
    // G-A: a plan action (PLAN_ACTION_DESCRIPTORS) runs only when the policy lists its kind.
    // Absent or empty `planActions` lists none. Only the task or config file sets it.
    if (requires.planAction !== undefined && !(config.planActions ?? []).includes(requires.planAction)) {
      denials.push(deny("destructive", "plan_action_not_allowed"));
    }
    return denials;
  }

  /** `undefined` means the field is absent and the tool default (the root) applies. */
  function pathValue(args: unknown, field: string, access: PathAccess): unknown {
    const value = readField(args, field);
    return value === undefined && access === "cwd" ? "." : value;
  }

  return {
    restorableFields,

    checkRequested(call, descriptor) {
      const requires = requirementsOf(descriptor);
      const denials = checkFixed(requires, call.args, "requested");
      const restorable = restorableFields(descriptor);
      for (const { field, access } of requires.paths) {
        const value = pathValue(call.args, field, access);
        if (typeof value !== "string") {
          denials.push(deny("path", "invalid_path"));
        } else if (tokenLike.test(value)) {
          // The real path is unknown until restoration. `checkEffective` judges it.
          if (!restorable.includes(field)) {
            denials.push(deny("restore", "restore_denied"));
          }
        } else {
          const outcome = lexicalCheck(workspace.root, value);
          if (!outcome.ok) {
            denials.push(deny("path", outcome.code));
          } else if (access !== "aggregate" && unreadable.covers(outcome.relative)) {
            // U-203 (R-3): only query_table's `aggregate` reaches under an unreadable path.
            denials.push(deny("path", "unreadable_path"));
          } else if (access === "write" && protectedPaths.covers(outcome.relative)) {
            denials.push(deny("path", "protected_path"));
          }
        }
      }
      return decide(denials);
    },

    async checkEffective(call, descriptor) {
      const requires = requirementsOf(descriptor);
      const denials = checkFixed(requires, call.args, "effective");
      for (const { field, access } of requires.paths) {
        const value = pathValue(call.args, field, access);
        if (typeof value !== "string") {
          denials.push(deny("path", "invalid_path"));
        } else if (tokenLike.test(value)) {
          // A token that is still present was not restored. It is not a usable path.
          denials.push(deny("restore", "restore_denied"));
        } else {
          const outcome = await workspace.resolve(value, access);
          // U-189 (T-1): the real path judged here; the tool, resolving the argument again, must land on it.
          if (outcome.ok) noteJudged(workspace, value, access, outcome.path);
          if (!outcome.ok) {
            denials.push(deny("path", outcome.code));
          } else if (access !== "aggregate" && (await unreadable.coversEffective(outcome.path.relative, workspace))) {
            // U-203 (R-3): after links are resolved, and each entry's real path too.
            denials.push(deny("path", "unreadable_path"));
          } else if (access === "write" && (await protectedPaths.coversEffective(outcome.path.relative, workspace))) {
            // Compared after links are resolved, so a link cannot lead around a protected path,
            // and each entry is resolved too, so a link entry protects its real path (T-13).
            denials.push(deny("path", "protected_path"));
          } else if (access === "write" && !(await writableEffective(outcome.path.relative))) {
            // U-175 (B-2): every writable list must cover the resolved path (the intersection).
            denials.push(deny("path", "path_not_writable"));
          }
        }
      }
      return decide(denials);
    },
  };
};

