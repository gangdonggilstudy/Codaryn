/**
 * Policy gate: every required permission is judged on its own, before and after restoration.
 * Requirements come from the tool descriptor and the fixed table in the contracts.
 * Nothing in the call arguments or in workspace files can lower them.
 */

import { BUILTIN_TOOLS, PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE } from "../contracts/index.js";
import type {
  CommandRule,
  CreatePolicyGate,
  PathAccess,
  PermissionKind,
  PolicyDecision,
  PolicyDenialCode,
  ToolDescriptor,
  ToolRequirements,
} from "../contracts/index.js";
import { lexicalCheck } from "../workspace/lexical.js";
import { compileProtectedPaths } from "./protected.js";

type Denial = Extract<PolicyDecision, { allowed: false }>;

const ALLOWED: PolicyDecision = { allowed: true };

/** When several permissions are denied, the first one in this order is reported. */
const REPORT_ORDER: readonly PermissionKind[] = ["path", "command", "network", "destructive", "restore"];

function deny(permission: PermissionKind, code: PolicyDenialCode): Denial {
  return { allowed: false, permission, code };
}

function decide(denials: readonly Denial[]): PolicyDecision {
  for (const permission of REPORT_ORDER) {
    const found = denials.find((denial) => denial.permission === permission);
    if (found !== undefined) {
      return found;
    }
  }
  return ALLOWED;
}

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

export const createPolicyGate: CreatePolicyGate = ({ config, workspace }) => {
  const tokenLike = new RegExp(PRIVACY_TOKEN_FRAGMENT_PATTERN_SOURCE, "i");
  // Only the config decides what is protected. Writes are denied; reads and `cwd` are not.
  const protectedPaths = compileProtectedPaths(config.protectedPaths);

  function restorableFields(descriptor: ToolDescriptor): readonly string[] {
    return config.restorePathTokens === true ? [...descriptor.restoreFields] : [];
  }

  function checkCommand(args: unknown): Denial | null {
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
    return rules.some((rule) => matchesRule(rule, callArgs)) ? null : deny("command", "args_not_allowed");
  }

  /** Checks that do not depend on paths: command, network, destructive. */
  function checkFixed(requires: ToolRequirements, args: unknown): Denial[] {
    const denials: Denial[] = [];
    if (requires.command) {
      const denial = checkCommand(args);
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
      const denials = checkFixed(requires, call.args);
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
          } else if (access === "write" && protectedPaths.covers(outcome.relative)) {
            denials.push(deny("path", "protected_path"));
          }
        }
      }
      return decide(denials);
    },

    async checkEffective(call, descriptor) {
      const requires = requirementsOf(descriptor);
      const denials = checkFixed(requires, call.args);
      for (const { field, access } of requires.paths) {
        const value = pathValue(call.args, field, access);
        if (typeof value !== "string") {
          denials.push(deny("path", "invalid_path"));
        } else if (tokenLike.test(value)) {
          // A token that is still present was not restored. It is not a usable path.
          denials.push(deny("restore", "restore_denied"));
        } else {
          const outcome = await workspace.resolve(value, access);
          if (!outcome.ok) {
            denials.push(deny("path", outcome.code));
          } else if (access === "write" && protectedPaths.covers(outcome.path.relative)) {
            // Compared after links are resolved, so a link cannot lead around a protected path.
            denials.push(deny("path", "protected_path"));
          }
        }
      }
      return decide(denials);
    },
  };
};
