/**
 * Fixtures for the general task cases (G-G, docs/design/general-tasks.md section 10.2): an
 * organize workspace with text, binary, empty and duplicate files, an independent oracle for what
 * a plan does to it, sales tables whose aggregates are worked out by hand, and writers for task
 * and script files that carry the stage 4 fields.
 *
 * The stage 4 fields (`workflowRef`, `tools`, `plan`, `completion`, `humanReview`,
 * `policy.planActions`, `data_checks` verifiers) are written as plain JSON, so these fixtures do
 * not depend on the G-A contract types. Every byte is generated here at run time; nothing is
 * read from the repository.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { JsonObject, ScriptStep } from "../../src/contracts/index.js";
import type { Sandbox } from "./builders.js";

/** Scripted steps report zero tokens, so a numeric token limit is never `usage_unknown`. */
export const ZERO_USAGE = { inputTokens: 0, outputTokens: 0 } as const;

/** One model turn that calls one tool. */
export function toolStep(name: string, args: JsonObject, id?: string): ScriptStep {
  return { toolCalls: [{ ...(id === undefined ? {} : { id }), name, args }], usage: ZERO_USAGE };
}

/** One model turn that answers with text and calls nothing. */
export function textStep(text: string): ScriptStep {
  return { text, usage: ZERO_USAGE };
}

/** SHA-256 of the bytes, 64 lowercase hex characters (ContentHash). */
export function sha256Of(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export interface GeneralTaskOptions {
  readonly id: string;
  readonly goal?: string;
  /** The free label (`workflow`). Defaults to "general". */
  readonly label?: string;
  /** Stage 4 fields and any other top-level task field, written as given. */
  readonly fields?: JsonObject;
  /** Merged into the base policy (`planActions`, `protectedPaths`, `commands`...). */
  readonly policy?: JsonObject;
  /** Verifier objects as JSON (`file_rules`, `command`, `data_checks`). Defaults to none. */
  readonly verifiers?: readonly JsonObject[];
  /** Merged into the base limits. */
  readonly limits?: JsonObject;
}

/**
 * Writes `<base>/task.json` for the scripted model (`<base>/script.json`, workspace `./ws`) with
 * the same base as builders.writeTask, plus the given stage 4 fields. Returns the task path.
 */
export function writeGeneralTask(sandbox: Sandbox, options: GeneralTaskOptions, steps?: readonly ScriptStep[]): string {
  const task: JsonObject = {
    schemaVersion: 1,
    id: options.id,
    goal: options.goal ?? "통합 테스트 범용 작업",
    workflow: options.label ?? "general",
    workspaceRoot: "./ws",
    model: { provider: "scripted", scriptPath: "./script.json" },
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, ...options.policy },
    privacy: { secretEnv: [] },
    limits: { maxModelTurns: 12, maxToolCalls: 24, maxTotalTokens: 1000, maxDurationMs: 60_000, ...options.limits },
    verifiers: [...(options.verifiers ?? [])],
    ...options.fields,
  };
  if (steps !== undefined) writeFileSync(sandbox.scriptPath, JSON.stringify({ schemaVersion: 1, steps }, null, 2));
  writeFileSync(sandbox.taskPath, JSON.stringify(task, null, 2));
  return sandbox.taskPath;
}

// ---------------------------------------------------------------------------------------------
// Organize (GI-02 to GI-05)

/** 256 bytes 0x00..0xFF: not UTF-8, so a text tool cannot carry it and a move must keep it intact. */
const ALL_BYTES = Uint8Array.from({ length: 256 }, (_, index) => index);
const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function concat(...parts: readonly (string | Uint8Array)[]): Buffer {
  return Buffer.concat(parts.map((part) => (typeof part === "string" ? Buffer.from(part, "utf8") : Buffer.from(part))));
}

const PHOTO = concat(PNG_SIGNATURE, ALL_BYTES, ALL_BYTES);

/**
 * The organize workspace, path → bytes. Covers a Korean name with a space, CRLF and a BOM, two
 * binary files (one not even starting like text), a byte-identical duplicate, an empty file and a
 * file the plan does not touch.
 */
export const ORGANIZE_FILES: ReadonlyMap<string, Buffer> = new Map<string, Buffer>([
  ["inbox/회의록 2026-11.md", concat("﻿# 11월 회의록\r\n\r\n- 결정: 문서 사이트 개편\r\n")],
  ["inbox/budget.csv", concat("item,amount\nhosting,120\ndomain,15\n")],
  ["inbox/photo.png", PHOTO],
  ["inbox/photo copy.png", Buffer.from(PHOTO)],
  ["inbox/scan.pdf", concat("%PDF-1.4\n", ALL_BYTES, "\n%%EOF\n")],
  ["inbox/old.tmp", concat("temporary\n")],
  ["inbox/empty.txt", Buffer.alloc(0)],
  ["keep/readme.txt", concat("이 폴더는 그대로 둔다.\n")],
]);

export type OrganizeAction =
  | { readonly kind: "move"; readonly from: string; readonly to: string }
  | { readonly kind: "discard"; readonly path: string };

/** A plan that sorts every inbox file and discards the duplicate and the temporary file. */
export const ORGANIZE_ACTIONS: readonly OrganizeAction[] = [
  { kind: "move", from: "inbox/회의록 2026-11.md", to: "docs/meetings/회의록 2026-11.md" },
  { kind: "move", from: "inbox/budget.csv", to: "data/budget.csv" },
  { kind: "move", from: "inbox/photo.png", to: "images/photo.png" },
  { kind: "move", from: "inbox/scan.pdf", to: "docs/scan.pdf" },
  { kind: "move", from: "inbox/empty.txt", to: "docs/empty.txt" },
  { kind: "discard", path: "inbox/photo copy.png" },
  { kind: "discard", path: "inbox/old.tmp" },
];

/** Writes ORGANIZE_FILES into the workspace and returns a copy of them. */
export function writeOrganizeWorkspace(sandbox: Sandbox): Map<string, Buffer> {
  for (const [path, bytes] of ORGANIZE_FILES) {
    const full = join(sandbox.workspace, ...path.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, bytes);
  }
  return new Map(ORGANIZE_FILES);
}

/**
 * The oracle: the workspace files after `actions`, worked out without any product code. A move
 * renames, a discard removes from the workspace (the file then lies in the discarded directory,
 * which treeBytes(…, true) leaves out with the rest of the state directory). Throws when the plan
 * would not fit, so a case cannot expect a result the product should refuse.
 */
export function afterActions(files: ReadonlyMap<string, Buffer>, actions: readonly OrganizeAction[]): Map<string, Buffer> {
  const out = new Map(files);
  for (const action of actions) {
    const source = action.kind === "move" ? action.from : action.path;
    const bytes = out.get(source);
    if (bytes === undefined) throw new Error(`fixture plan: source missing (${action.kind})`);
    out.delete(source);
    if (action.kind === "move") {
      if (out.has(action.to)) throw new Error("fixture plan: destination exists");
      out.set(action.to, bytes);
    }
  }
  return out;
}

/** The plan as `propose_plan` arguments. */
export function proposePlanArgs(actions: readonly OrganizeAction[], summary = "inbox 파일을 종류별 폴더로 옮기고 중복과 임시 파일을 버린다"): JsonObject {
  return { summary, actions: actions.map((action) => ({ ...action })) };
}

// ---------------------------------------------------------------------------------------------
// Analyze (GI-06, GI-07)

/**
 * A sales table with CRLF line ends, a quoted comma, a quoted quote and one empty amount cell.
 * Worked out by hand (amount, empty cells skipped):
 * - north: 120.50, 30 → count 2, sum 150.5, min 30, max 120.5, mean 75.25
 * - south: 80, 19.5   → count 2, sum 99.5,  min 19.5, max 80, mean 49.75
 * - east:  45 (one empty cell) → count 1, sum 45, min 45, max 45, mean 45
 * - all:   count 5, sum 295
 */
export const SALES_CSV = [
  "region,product,amount",
  'north,"Widget, large",120.50',
  'south,"Gadget ""Pro""",80',
  "north,Widget,30",
  "east,Gizmo,",
  "south,Gadget,19.5",
  "east,Doohickey,45",
  "",
].join("\r\n");

export const SALES_BY_REGION = {
  east: { count: 1, sum: 45, min: 45, max: 45, mean: 45 },
  north: { count: 2, sum: 150.5, min: 30, max: 120.5, mean: 75.25 },
  south: { count: 2, sum: 99.5, min: 19.5, max: 80, mean: 49.75 },
} as const;

/** The summary table the model should write (`out/summary.csv`). */
export const SALES_SUMMARY_CSV = ["region,total,count", "east,45,1", "north,150.5,2", "south,99.5,2", ""].join("\n");
/** The same with north's total off by 0.5 (the half dropped): aggregate_match must fail on it. */
export const SALES_SUMMARY_WRONG_CSV = ["region,total,count", "east,45,1", "north,150,2", "south,99.5,2", ""].join("\n");
/** A source whose amount column holds a non-number: the check cannot judge the output (inconclusive). */
export const SALES_CSV_NOT_A_NUMBER = ["region,product,amount", "north,Widget,12abc", "south,Gadget,3", ""].join("\n");

export const SALES_REPORT_MD = "# 지역별 매출\n\n- north가 가장 많다(150.5).\n- east는 금액이 빈 행이 하나 있다.\n";

/** `data_checks` for SALES_SUMMARY_CSV against SALES_CSV, as JSON. */
export function salesDataChecks(source = "data/sales.csv", target = "out/summary.csv"): JsonObject {
  return {
    id: "sales",
    kind: "data_checks",
    rules: [
      { type: "table_shape", table: { path: target, format: "csv" }, columns: ["region", "total", "count"], rows: { equals: 3 } },
      {
        type: "aggregate_match",
        source: { path: source, format: "csv" },
        column: "amount",
        op: "sum",
        groupBy: "region",
        target: { path: target, format: "csv" },
        targetColumn: "total",
        targetKeyColumn: "region",
      },
      {
        type: "aggregate_match",
        source: { path: source, format: "csv" },
        column: "amount",
        op: "count",
        groupBy: "region",
        target: { path: target, format: "csv" },
        targetColumn: "count",
        targetKeyColumn: "region",
      },
    ],
  };
}

/** Writes the sales source into the workspace (`data/sales.csv` by default). */
export function writeSalesSource(sandbox: Sandbox, text = SALES_CSV, path = "data/sales.csv"): string {
  const full = join(sandbox.workspace, ...path.split("/"));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text, "utf8");
  return full;
}
