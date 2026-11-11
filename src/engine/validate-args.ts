/**
 * Shape validation of tool arguments. It checks structure only.
 * Whether a call is permitted is decided by the policy gate.
 */

import { CONTENT_HASH_PATTERN_SOURCE, MAX_COMMAND_TIMEOUT_MS } from "../contracts/index.js";
import type { JsonObject, JsonValue, ToolArgsByName, ToolName } from "../contracts/index.js";

const HASH_PATTERN = new RegExp(CONTENT_HASH_PATTERN_SOURCE);

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: JsonObject, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isNonEmptyString(value: JsonValue | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function isOptionalString(value: JsonValue | undefined): boolean {
  return value === undefined || typeof value === "string";
}

function isValidChange(change: JsonValue | undefined): boolean {
  if (!isObject(change)) return false;
  if (change["kind"] === "replace_all") {
    return hasOnlyKeys(change, ["kind", "content"]) && typeof change["content"] === "string";
  }
  if (change["kind"] === "replace_text") {
    return (
      hasOnlyKeys(change, ["kind", "oldText", "newText"]) &&
      isNonEmptyString(change["oldText"]) &&
      typeof change["newText"] === "string"
    );
  }
  return false;
}

function isValid(name: ToolName, args: JsonObject): boolean {
  switch (name) {
    case "read_file":
      return hasOnlyKeys(args, ["path"]) && isNonEmptyString(args["path"]);
    case "search_files":
      return (
        hasOnlyKeys(args, ["path", "nameContains", "text"]) &&
        isNonEmptyString(args["path"]) &&
        isOptionalString(args["nameContains"]) &&
        isOptionalString(args["text"])
      );
    case "write_file": {
      if (!hasOnlyKeys(args, ["path", "expectedHash", "change"])) return false;
      if (!isNonEmptyString(args["path"])) return false;
      // expectedHash is required: a hash, or an explicit null for a file that must not exist.
      if (!Object.hasOwn(args, "expectedHash")) return false;
      const expected = args["expectedHash"];
      if (expected !== null && !(typeof expected === "string" && HASH_PATTERN.test(expected))) {
        return false;
      }
      return isValidChange(args["change"]);
    }
    case "run_command": {
      if (!hasOnlyKeys(args, ["executable", "args", "cwd", "timeoutMs"])) return false;
      if (!isNonEmptyString(args["executable"])) return false;
      const list = args["args"];
      if (!Array.isArray(list) || !list.every((item) => typeof item === "string")) return false;
      if (!isOptionalString(args["cwd"])) return false;
      const timeout = args["timeoutMs"];
      // T-3: a model may not ask for a longer command time limit than MAX_COMMAND_TIMEOUT_MS.
      return (
        timeout === undefined ||
        (typeof timeout === "number" &&
          Number.isInteger(timeout) &&
          timeout > 0 &&
          timeout <= MAX_COMMAND_TIMEOUT_MS)
      );
    }
  }
}

/** Returns the arguments typed for the tool, or `null` when the shape is invalid. */
export function validateToolArgs<N extends ToolName>(
  name: N,
  args: JsonObject,
): ToolArgsByName[N] | null {
  return isValid(name, args) ? (args as unknown as ToolArgsByName[N]) : null;
}
