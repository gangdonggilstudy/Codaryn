/**
 * Codex V-14 L-1 (B-4 end to end): writes refused as path_not_writable were counted by the run
 * (RunNotes.deniedNotWritable) but not handed to the end summary (RunSummaryContext.deniedNotWritable,
 * U-198's `summary.denied_not_writable` line), so the real CLI never showed it; and a run that carries
 * out a run plan told the person to add the file to writablePaths although its approved files refused
 * the write, which no writablePaths entry can widen.
 * Now, on the real CLI (a process, other denials mixed in):
 * - the end summary has the line with the count of writes refused as not writable;
 * - in a run that carries out a plan, a refused write gets the plan's hint (make a new plan and approve
 *   it), not the writablePaths hint, also for a file the apply task's writablePaths names: a planned
 *   file a writable list leaves out ends the run as plan_stale before the model (U-187), so every
 *   refused write of a carried run is outside the plan;
 * - a run without a plan keeps the writablePaths hint.
 * Scripted model, temporary folders; no network.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { JsonObject, MessageCatalog } from "../../../src/contracts/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { cliEnv } from "../../support/cli.js";
import type { CliRun } from "../../support/cli.js";
import { runGuarded } from "../../support/fake-anthropic.js";
import { writeConfigFile } from "../../fixtures/anthropic.js";
import { createSandbox, writeWorkspaceFile } from "../../fixtures/builders.js";
import type { Sandbox } from "../../fixtures/builders.js";
import { createFileArgs, textStep, toolStep, writeGeneralTask } from "../../fixtures/general-tasks.js";

const OLD_GUIDE = "old guide\n";
const LIMITS = { maxModelTurns: 10, maxToolCalls: 24, maxTotalTokens: 200_000, maxDurationMs: 60_000 };
const REWRITE = { tools: ["read_file", "search_files", "write_file", "propose_changes"], plan: "run" };
const PLANNED = [
  { path: "docs/guide.md", change: "modify" },
  { path: "docs/new.md", change: "create" },
];
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const json = (run: CliRun): Record<string, unknown> => JSON.parse(run.stdout.trim().split("\n").pop() ?? "") as Record<string, unknown>;
/** Catalog lines by id, loosely typed, so this file builds before the new id exists. */
const line = (catalog: MessageCatalog, id: string, count: number): string => (catalog.format as (id: string, params: object) => string)(id, { count });
const guideWrite = toolStep("write_file", { path: "docs/guide.md", expectedHash: sha256(OLD_GUIDE), change: { kind: "replace_all", content: "new guide\n" } });

interface Planned {
  readonly form: readonly string[];
  readonly runId: string;
  readonly digest: string;
}

/** A run plan of docs/guide.md and docs/new.md, made with a config's task type. */
async function makePlan(sb: Sandbox, policy: JsonObject = {}): Promise<Planned> {
  writeWorkspaceFile(sb, "README.md", "# Title\n");
  writeWorkspaceFile(sb, "docs/guide.md", OLD_GUIDE);
  const config = writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, workflows: { rewrite: REWRITE } }, "c.json");
  const steps = [toolStep("propose_changes", { summary: "rewrite the guide and add a page", files: PLANNED }), textStep("not requested")];
  const task = writeGeneralTask(sb, { id: "v14", goal: "rewrite the guide", fields: { workflowRef: "rewrite" }, limits: LIMITS, policy }, steps);
  const form = ["--task", task, "--config", config];
  const made = json(await runGuarded(sb, ["run", ...form], cliEnv()));
  assert.equal(made["reason"], "plan_pending", JSON.stringify(made));
  return { form, runId: made["runId"] as string, digest: (made["plan"] as { digest: string }).digest };
}

/** Carries the plan out with these steps; the task file is rewritten first when `policy` is given. */
async function carry(sb: Sandbox, planned: Planned, steps: readonly ReturnType<typeof toolStep>[], lang: string, policy?: JsonObject): Promise<CliRun> {
  if (policy !== undefined) writeGeneralTask(sb, { id: "v14", goal: "rewrite the guide", fields: { workflowRef: "rewrite" }, limits: LIMITS, policy });
  writeFileSync(sb.scriptPath, JSON.stringify({ schemaVersion: 1, steps }));
  const ran = await runGuarded(sb, ["apply", ...planned.form, "--run", planned.runId, "--digest", planned.digest.slice(0, 12)], cliEnv({ extra: { CODARYN_LANG: lang } }));
  assert.equal(json(ran)["kind"], "run", ran.stdout);
  return ran;
}

describe("V-14 L-1 on the real CLI: refused writes in the end summary and the right hint", () => {
  test("a carried plan, writes outside it mixed with another denial: the summary's count and the plan's hint", { timeout: 120_000 }, async (t) => {
    const sb = createSandbox(t);
    const planned = await makePlan(sb);
    const steps = [
      toolStep("run_command", { executable: process.execPath, args: ["-e", "0"] }),
      toolStep("write_file", createFileArgs("not-approved.txt", "x\n")),
      toolStep("write_file", createFileArgs("docs/guide.md.extra", "x\n")),
      guideWrite,
      toolStep("write_file", createFileArgs("docs/new.md", "new page\n")),
      textStep("done"),
    ];
    const ran = await carry(sb, planned, steps, "en");
    const en = createMessageCatalog("en");
    assert.ok(ran.stderr.includes(line(en, "summary.denied", 3)), ran.stderr);
    assert.ok(ran.stderr.includes(line(en, "summary.denied_not_writable", 2)), ran.stderr);
    assert.ok(ran.stderr.includes(line(en, "progress.not_in_plan_hint", 2)), ran.stderr);
    assert.equal(ran.stderr.includes("add it to writablePaths"), false, "no writablePaths hint for files the plan did not approve");
    assert.equal(existsSync(path.join(sb.workspace, "not-approved.txt")) || existsSync(path.join(sb.workspace, "docs", "guide.md.extra")), false);
    assert.equal(readFileSync(path.join(sb.workspace, "docs", "new.md"), "utf8"), "new page\n");
  });

  test("a file the apply task's writablePaths names but the plan does not: the plan's hint (Korean)", { timeout: 120_000 }, async (t) => {
    const sb = createSandbox(t);
    const planned = await makePlan(sb);
    const steps = [toolStep("write_file", createFileArgs("other.txt", "x\n")), guideWrite, toolStep("write_file", createFileArgs("docs/new.md", "new page\n")), textStep("done")];
    // DR-5: the apply's own task; its list covers both planned files and other.txt.
    const ran = await carry(sb, planned, steps, "ko", { writablePaths: ["docs", "other.txt"] });
    const ko = createMessageCatalog("ko");
    assert.ok(ran.stderr.includes(line(ko, "summary.denied_not_writable", 1)), ran.stderr);
    assert.ok(ran.stderr.includes(line(ko, "progress.not_in_plan_hint", 1)), ran.stderr);
    assert.equal(ran.stderr.includes(line(ko, "progress.not_writable_hint", 1)), false, "widening writablePaths would not help");
    assert.equal(existsSync(path.join(sb.workspace, "other.txt")), false);
    assert.equal(readFileSync(path.join(sb.workspace, "docs", "new.md"), "utf8"), "new page\n");
  });

  test("a planned file the apply task's writablePaths leaves out: plan_stale before the model, no hint", { timeout: 120_000 }, async (t) => {
    const sb = createSandbox(t);
    const planned = await makePlan(sb);
    const ran = await carry(sb, planned, [guideWrite, textStep("not requested")], "en", { writablePaths: ["docs/guide.md"] });
    const result = json(ran);
    assert.equal(`${String(result["status"])}/${String(result["reason"])}`, "failed/plan_stale", ran.stdout);
    assert.equal((result["usage"] as { modelTurns: number }).modelTurns, 0);
    const en = createMessageCatalog("en");
    assert.equal(ran.stderr.includes(line(en, "progress.not_in_plan_hint", 1)) || ran.stderr.includes("add it to writablePaths"), false);
  });

  test("a run without a plan: the summary's count and the writablePaths hint, beside a command denial", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    writeWorkspaceFile(sb, "README.md", "# Title\n");
    const steps = [toolStep("run_command", { executable: process.execPath, args: ["-e", "0"] }), toolStep("write_file", createFileArgs("b.txt", "x\n")), textStep("done")];
    const task = writeGeneralTask(sb, { id: "v14-plain", policy: { writablePaths: ["out"] } }, steps);
    const ran = await runGuarded(sb, ["run", "--task", task], cliEnv({ extra: { CODARYN_LANG: "en" } }));
    assert.equal(json(ran)["kind"], "run", ran.stdout);
    const en = createMessageCatalog("en");
    assert.ok(ran.stderr.includes(line(en, "summary.denied", 2)), ran.stderr);
    assert.ok(ran.stderr.includes(line(en, "summary.denied_not_writable", 1)), ran.stderr);
    assert.ok(ran.stderr.includes(line(en, "progress.not_writable_hint", 1)), ran.stderr);
    assert.equal(ran.stderr.includes(line(en, "progress.not_in_plan_hint", 1)), false);
  });
});
