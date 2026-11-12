/**
 * N-14 to N-18 (contract review of 9735b5f: H1, M1, M2, M3, L1). The inputs are the review's
 * synthetic values. The `@ts-expect-error` lines are part of the test: `tsc` fails when a value
 * from a file could be passed into a message again.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_CONFIG_DISPLAY,
  FIXED_MESSAGES,
  MESSAGE_IDS,
  RUNS_EXIT_CODES,
  SCHEMA_FIELD_NAMES,
  messageParams,
  toRunId,
  toSchemaFieldPath,
} from "../../../src/contracts/index.js";
import type {
  CatalogText,
  CliErrorOutput,
  DefaultConfigDisplay,
  DefaultConfigLocation,
  InitOutput,
  MessageCatalog,
  RunListEntry,
  RunSummaryContext,
  RunsOutput,
} from "../../../src/contracts/index.js";

const SYNTHETIC = "SYNTHETIC_PRIVATE_VALUE";

/** A catalog that only records what it was asked for. */
function recordingCatalog(): MessageCatalog & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    language: "en",
    calls,
    format(id: string, params?: unknown) {
      calls.push([id, params]);
      return id as CatalogText;
    },
  } as MessageCatalog & { calls: unknown[] };
}

test("N-14 (H1): a message parameter takes only its declared type, never free text", () => {
  const catalog = recordingCatalog();
  // Accepted: numbers, fixed codes, schema field positions, fixed display strings.
  catalog.format("summary.changes", { count: 2 });
  catalog.format("progress.tool_denied", { tool: catalog.format("tool.run_command"), permission: "command", code: "command_not_allowed" });
  catalog.format("init.saved", { location: DEFAULT_CONFIG_DISPLAY.windows });
  const field = toSchemaFieldPath("policy.commands[2].executable");
  assert.ok(field !== null);
  catalog.format("diagnostic.invalid_value", { field });

  // @ts-expect-error a string from a file is not a count
  catalog.format("summary.changes", { count: SYNTHETIC });
  // @ts-expect-error there is no free-text detail parameter any more
  catalog.format("error.detail", { detail: SYNTHETIC });
  // @ts-expect-error a field position must come from toSchemaFieldPath
  catalog.format("diagnostic.invalid_value", { field: SYNTHETIC });
  // @ts-expect-error a code parameter is a closed union
  catalog.format("progress.tool_denied", { tool: catalog.format("tool.run_command"), permission: SYNTHETIC, code: "command_not_allowed" });
  // @ts-expect-error another message's text must come from the catalog
  catalog.format("progress.tool_allowed", { tool: SYNTHETIC });
  // @ts-expect-error a location is one of the fixed display strings
  catalog.format("init.saved", { location: "C:\\Users\\someone\\AppData\\Roaming\\Codaryn\\config.json" });
  // @ts-expect-error a verifier is shown by its number, never by its id
  catalog.format("progress.verifier", { id: "customer private memo", outcome: catalog.format("outcome.pass") });
  catalog.format("progress.verifier", { number: 1, outcome: catalog.format("outcome.pass") });
  // @ts-expect-error a listed id takes no parameters
  catalog.format("status.done", { count: 1 });
});

test("N-14 (H1): display locations are narrowed to the fixed constants", () => {
  const display: DefaultConfigDisplay = DEFAULT_CONFIG_DISPLAY.xdg;
  const location: DefaultConfigLocation = { path: "/home/x/.config/codaryn/config.json", display };
  // @ts-expect-error the display string cannot be an expanded path
  const wrong: DefaultConfigLocation = { path: "/x", display: "/home/someone/.config/codaryn/config.json" };
  const init: InitOutput["config"] = { source: "argument", display: "--config" };
  // @ts-expect-error neither can init's
  const wrongInit: InitOutput["config"] = { source: "default", display: "/home/someone/.config/codaryn/config.json" };
  assert.ok(location && init && wrong && wrongInit);
});

test("N-14 (H1): schema field positions accept known field names and indices only", () => {
  for (const ok of ["config", "task", "limits.maxModelTurns", "policy.commands[2].executable", "verifiers[0].rules[1].text", "profiles[3].limits.maxToolCalls"]) {
    assert.equal(toSchemaFieldPath(ok), ok, ok);
  }
  for (const bad of [
    SYNTHETIC,
    "customer private memo",
    "verifiers[0].customer",
    "profiles.work.limits",
    "limits.maxModelTurns.",
    "policy.commands[-1]",
    "policy.commands[1e3]",
    "config\nlimits",
    "",
  ]) {
    assert.equal(toSchemaFieldPath(bad), null, JSON.stringify(bad));
  }
  assert.ok(SCHEMA_FIELD_NAMES.includes("maxModelTurns"));
});

test("N-14: every fixed message declares only known parameter kinds; listed ids take none", () => {
  const kinds = new Set(["count", "status", "reason", "permission", "denial", "modelError", "phase", "provider", "keyEnv", "settingEnv", "apiOrigin", "field", "runId", "text", "location", "suggestedCommand", "suggestedPath", "seconds", "language", "digest"]);
  for (const id of MESSAGE_IDS) {
    for (const kind of Object.values(messageParams(id))) assert.ok(kinds.has(kind), `${id}: ${kind}`);
  }
  assert.equal(Object.hasOwn(FIXED_MESSAGES, "error.detail"), false);
  assert.deepEqual(messageParams("status.done"), {});
});

test("N-15 (M1): an input error may carry a structured diagnostic with a field position and line/column numbers", () => {
  const field = toSchemaFieldPath("limits");
  assert.ok(field !== null);
  const output: CliErrorOutput = {
    schemaVersion: 1,
    kind: "error",
    code: "invalid_config",
    exitCode: 2,
    message: "the config file cannot be read as JSON",
    diagnostic: { code: "json_syntax", file: "config", field: null, line: 3, column: 13 },
  };
  const unknown: CliErrorOutput = {
    ...output,
    diagnostic: { code: "unknown_field", file: "config", field, line: null, column: null, suggestion: toSchemaFieldPath("limits.maxModelTurns") },
  };
  // @ts-expect-error the diagnostic cannot carry the parser's message or a raw key name
  const leaky: CliErrorOutput = { ...output, diagnostic: { code: "json_syntax", file: "config", field: SYNTHETIC, line: 1, column: 1 } };
  assert.ok(unknown && leaky);
});

test("N-16 (M2): a run list entry is either checked or damaged; a damaged one carries nothing but its id", () => {
  const runId = toRunId("20261112T031500Z-9f2c41ab");
  assert.ok(runId !== null);
  const damaged: RunListEntry = { state: "damaged", runId };
  // @ts-expect-error a damaged entry has no task id, time or status
  const leaky: RunListEntry = { state: "damaged", runId, taskId: SYNTHETIC };
  const output: RunsOutput = { schemaVersion: 1, kind: "runs", status: "listed", exitCode: RUNS_EXIT_CODES.listed, runs: [damaged], omitted: 0 };
  assert.ok(leaky && output);
  assert.equal(toRunId("../x"), null);
  assert.equal(toRunId("a b"), null);
});

test("N-17 (M3): the end-of-run summary receives the denied call count", () => {
  const context: RunSummaryContext = {
    workspaceForm: "given",
    configDefault: null,
    profileApplied: false,
    deniedToolCalls: 1,
    deniedCommandCalls: 1,
    policySource: "config",
  };
  // @ts-expect-error the count is required
  const missing: RunSummaryContext = { workspaceForm: "given", configDefault: null, profileApplied: false, deniedCommandCalls: 0, policySource: "config" };
  // @ts-expect-error the typed workspace path is never passed to the renderer
  const typed: RunSummaryContext = { ...context, workspace: SYNTHETIC };
  assert.ok(missing && typed);
  assert.equal(context.deniedToolCalls, 1);
});
