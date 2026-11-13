/**
 * U-170 (DR-69, P1 bundle B, proposal B-1 to B-8): the contract of plan mode `run`, before anything
 * carries it out. writablePaths: g-u170-writable-paths.test.ts.
 * - PLAN_MODES has `run`; `propose_changes` has its arguments, descriptor (`endsRun: "plan"`,
 *   `planMode: "run"`) and definition. U-180 (B-3) made it a task type tool.
 * - plan.json of a `run` plan is `kind: "changes"`: files, their hashes and the summary as visible
 *   parts. At most MAX_PLANNED_FILES (100) files, files only.
 * - plannedFileStale is B-6's one rule; the later run ends as the existing `plan_stale`.
 * - EngineResult.planRunId / planDigest and run_started's planRunId / planDigest / approval are
 *   optional, so every result and journal written before is as it was.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ALL_TOOL_DESCRIPTORS,
  ALL_TOOL_NAMES,
  APPROVAL_CHANNELS,
  CHANGES_PLAN_PROBLEMS,
  MAX_PLAN_SUMMARY_CHARS,
  MAX_PLANNED_FILES,
  PLAN_MODES,
  PLANNED_FILE_CHANGES,
  PLANNED_FILE_DESCRIPTOR,
  PLAN_ACTION_DESCRIPTORS,
  PROPOSE_CHANGES_DEFINITION,
  PROPOSE_CHANGES_DESCRIPTOR,
  PROPOSE_CHANGES_TOOL_NAME,
  RUN_REASONS_BY_STATUS,
  STORED_PLAN_KIND_BY_MODE,
  TOOL_NAME_PATTERN_SOURCE,
  WORKFLOW_TOOLS,
  WORKFLOW_TOOL_NAMES,
  maskedParts,
  plannedFileStale,
} from "../../../src/contracts/index.js";
import type {
  ContentHash,
  EngineResult,
  JournalEvent,
  JsonObject,
  ProposeChangesArgs,
  ResolvedPlannedFile,
  StoredChangesPlan,
} from "../../../src/contracts/index.js";

const HASH_A = "a".repeat(64) as ContentHash;
const HASH_B = "b".repeat(64) as ContentHash;
const RUN = "20261113T060000Z-0000aaaa";

const obj = (value: unknown): JsonObject => {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
  return value as JsonObject;
};

describe("U-170: plan mode run", () => {
  test("PLAN_MODES has run after the two that were", () => {
    assert.deepEqual([...PLAN_MODES], ["none", "apply", "run"]);
  });

  test("each plan mode's plan.json kind: apply keeps `plan`, run writes `changes`", () => {
    assert.deepEqual(STORED_PLAN_KIND_BY_MODE, { apply: "plan", run: "changes" });
  });

  test("the plan run's reason for a later run that no longer fits is the existing plan_stale", () => {
    assert.ok((RUN_REASONS_BY_STATUS.failed as readonly string[]).includes("plan_stale"));
  });
});

describe("U-170: propose_changes", () => {
  test("its descriptor ends the run as a plan of mode run, declares no path and is not a read", () => {
    const tool = PROPOSE_CHANGES_DESCRIPTOR;
    assert.equal(tool.name, PROPOSE_CHANGES_TOOL_NAME);
    assert.match(tool.name, new RegExp(TOOL_NAME_PATTERN_SOURCE));
    assert.deepEqual([tool.endsRun, tool.planMode], ["plan", "run"]);
    assert.notEqual(tool.displayClass, "read");
    assert.deepEqual(tool.requires.paths, []);
    assert.deepEqual(tool.restoreFields, []);
    assert.equal(tool.requires.command || tool.requires.network || tool.requires.destructive, false);
    assert.equal(tool.requires.planAction, undefined);
  });

  test("propose_plan is the plan tool of mode apply; no other tool ends a run", () => {
    assert.equal(WORKFLOW_TOOLS.propose_plan.planMode, "apply");
    for (const name of ALL_TOOL_NAMES) {
      const descriptor = ALL_TOOL_DESCRIPTORS[name];
      assert.equal(descriptor.planMode !== undefined, descriptor.endsRun === "plan", name);
    }
  });

  test("U-180 (B-3): a task type tool now, with the same descriptor as fixed before", () => {
    assert.equal((WORKFLOW_TOOL_NAMES as readonly string[]).includes(PROPOSE_CHANGES_TOOL_NAME), true);
    assert.equal((ALL_TOOL_NAMES as readonly string[]).includes(PROPOSE_CHANGES_TOOL_NAME), true);
    assert.equal(ALL_TOOL_DESCRIPTORS[PROPOSE_CHANGES_TOOL_NAME], PROPOSE_CHANGES_DESCRIPTOR);
  });

  test("its schema: a summary as long as propose_plan's, 1 to 100 files, each a path and create or modify", () => {
    const schema = PROPOSE_CHANGES_DEFINITION.inputSchema;
    assert.deepEqual(schema["required"], ["summary", "files"]);
    assert.equal(schema["additionalProperties"], false);
    const properties = obj(schema["properties"]);
    assert.deepEqual(obj(properties["summary"]), { type: "string", minLength: 1, maxLength: MAX_PLAN_SUMMARY_CHARS });
    const files = obj(properties["files"]);
    assert.deepEqual([files["type"], files["minItems"], files["maxItems"]], ["array", 1, MAX_PLANNED_FILES]);
    const item = obj(files["items"]);
    assert.deepEqual(item["required"], ["path", "change"]);
    assert.equal(item["additionalProperties"], false);
    assert.deepEqual(obj(obj(item["properties"])["change"])["enum"], [...PLANNED_FILE_CHANGES]);
    assert.ok(PROPOSE_CHANGES_DEFINITION.description.includes("After this call the run ends."));
  });

  test("B-5: at most 100 files, create or modify only; the problems are named once each", () => {
    assert.equal(MAX_PLANNED_FILES, 100);
    assert.deepEqual([...PLANNED_FILE_CHANGES], ["create", "modify"]);
    assert.equal(new Set(CHANGES_PLAN_PROBLEMS).size, CHANGES_PLAN_PROBLEMS.length);
    assert.ok(CHANGES_PLAN_PROBLEMS.includes("too_many") && CHANGES_PLAN_PROBLEMS.includes("file_exists"));
  });

  test("a planned file is judged by the gate as a write of its path, with no plan action kind", () => {
    assert.deepEqual(PLANNED_FILE_DESCRIPTOR.requires.paths, [{ field: "path", access: "write" }]);
    assert.equal(PLANNED_FILE_DESCRIPTOR.requires.planAction, undefined);
    assert.deepEqual(PLANNED_FILE_DESCRIPTOR.restoreFields, ["path"]);
    assert.equal(PLANNED_FILE_DESCRIPTOR.endsRun, undefined);
    const synthetic = [PLANNED_FILE_DESCRIPTOR.name, ...Object.values(PLAN_ACTION_DESCRIPTORS).map((descriptor) => descriptor.name)];
    assert.equal(new Set(synthetic).size, synthetic.length);
    for (const name of synthetic) assert.equal((ALL_TOOL_NAMES as readonly string[]).includes(name), false, `${name} is not a tool name`);
  });

  test("the arguments and the resolved file: a create has no hash, a modify has one", () => {
    const args: ProposeChangesArgs = { summary: "rewrite the guide", files: [{ path: "docs/guide.md", change: "modify" }] };
    assert.equal(args.files.length, 1);
    const created: ResolvedPlannedFile = { path: "docs/new.md", change: "create", sha256: null };
    const modified: ResolvedPlannedFile = { path: "docs/guide.md", change: "modify", sha256: HASH_A };
    assert.deepEqual([created.sha256, modified.sha256], [null, HASH_A]);
    // @ts-expect-error a create path holds nothing yet, so no hash is bound
    const wrongCreate: ResolvedPlannedFile = { path: "x", change: "create", sha256: HASH_A };
    // @ts-expect-error a modify binds the file's hash
    const wrongModify: ResolvedPlannedFile = { path: "x", change: "modify", sha256: null };
    assert.ok(wrongCreate && wrongModify);
  });
});

describe("U-170: plan.json of a run plan", () => {
  test("kind changes: the files with their hashes and shown paths, and the summary as visible parts", () => {
    const plan: StoredChangesPlan = {
      schemaVersion: 1,
      kind: "changes",
      runId: RUN,
      summary: maskedParts("rewrite the guide"),
      files: [
        { path: "docs/guide.md", change: "modify", sha256: HASH_A, shown: maskedParts("docs/guide.md") },
        { path: "docs/new.md", change: "create", sha256: null, shown: maskedParts("docs/new.md") },
      ],
    };
    assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan);
    assert.deepEqual(plan.summary, ["rewrite the guide"]);
    assert.equal(plan.kind, STORED_PLAN_KIND_BY_MODE.run);
  });
});

describe("U-170 B-6: plannedFileStale", () => {
  const modify: ResolvedPlannedFile = { path: "a.md", change: "modify", sha256: HASH_A };
  const create: ResolvedPlannedFile = { path: "b.md", change: "create", sha256: null };

  test("a modify still fits only as the same regular file with the same hash", () => {
    assert.equal(plannedFileStale(modify, { kind: "file", sha256: HASH_A }), false);
    assert.equal(plannedFileStale(modify, { kind: "file", sha256: HASH_B }), true, "changed since the plan");
    assert.equal(plannedFileStale(modify, { kind: "missing" }), true, "gone");
    assert.equal(plannedFileStale(modify, { kind: "other" }), true, "no longer a regular file");
  });

  test("a create still fits only while nothing is at its path", () => {
    assert.equal(plannedFileStale(create, { kind: "missing" }), false);
    assert.equal(plannedFileStale(create, { kind: "file", sha256: HASH_A }), true);
    assert.equal(plannedFileStale(create, { kind: "other" }), true);
  });
});

describe("U-170: the records of a run that carries out a run plan", () => {
  test("EngineResult.planRunId and planDigest are optional and plain JSON", () => {
    const fields: Pick<EngineResult, "planRunId" | "planDigest"> = { planRunId: RUN, planDigest: HASH_A };
    assert.deepEqual(JSON.parse(JSON.stringify(fields)), fields);
    const none: Pick<EngineResult, "planRunId" | "planDigest"> = {};
    assert.deepEqual(Object.keys(none), []);
  });

  test("run_started records the plan run, the digest and the approval channel, all optional", () => {
    type Started = Extract<JournalEvent, { readonly type: "run_started" }>;
    const fields: Pick<Started, "planRunId" | "planDigest" | "approval"> = { planRunId: RUN, planDigest: HASH_A, approval: "cli-flag" };
    assert.ok((APPROVAL_CHANNELS as readonly string[]).includes(fields.approval ?? ""));
    assert.deepEqual(JSON.parse(JSON.stringify(fields)), fields);
    const none: Pick<Started, "planRunId" | "planDigest" | "approval"> = {};
    assert.deepEqual(Object.keys(none), []);
  });
});
