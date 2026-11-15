/**
 * U-195 second part (DR-69 B-3, B-4, B-8): a run plan from end to end on the real CLI, with U-177's
 * refusal lifted. A config's task type with `plan: "run"` and propose_changes makes the plan; `plan`
 * shows it (ChangesPlanOutput); `apply --digest` carries it out with a model run given the plan run's
 * goal and told the approved plan; the result, `runs`, `report` (text and JSON) and `plan` name the
 * two runs; a second apply is refused and the run can be reverted. Once with the scripted model,
 * once against the loopback fake Anthropic server (127.0.0.1), whose request bodies show what the
 * model was told. Also: plan_weakened names both plan modes (the old text for "apply" and "none"),
 * and doctor warns when plan "run" and command rules come together (B-8).
 * Fake key, temporary folders.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { JsonObject, VerifierConfig } from "../../../src/contracts/index.js";
import { cliEnv } from "../../support/cli.js";
import type { CliRun } from "../../support/cli.js";
import { bodyOf, messagesRequests, replyText, replyTools, runGuarded, startFakeAnthropic, toolUse } from "../../support/fake-anthropic.js";
import { ANTHROPIC_LIMITS, fakeApiConfig, writeAnthropicTask, writeConfigFile } from "../../fixtures/anthropic.js";
import { createSandbox, nodeCommand, writeWorkspaceFile } from "../../fixtures/builders.js";
import type { Sandbox } from "../../fixtures/builders.js";
import { FAKE_API_KEY } from "../../fixtures/secrets.js";
import { createFileArgs, textStep, toolStep, writeGeneralTask } from "../../fixtures/general-tasks.js";

const GOAL = "rewrite the guide for new users";
const SUMMARY = "rewrite docs/guide.md and add docs/new.md";
const OLD_GUIDE = "old guide\n";
const LIMITS = { maxModelTurns: 8, maxToolCalls: 24, maxTotalTokens: 200_000, maxDurationMs: 60_000 };
const REWRITE = { tools: ["read_file", "search_files", "write_file", "propose_changes"], plan: "run" };
const CHECK = [{ id: "guide", kind: "file_rules", rules: [{ type: "contains", path: "docs/guide.md", text: "new guide" }] }];
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const json = (run: CliRun): Record<string, unknown> => JSON.parse(run.stdout.trim().split("\n").pop() ?? "") as Record<string, unknown>;
const PLANNED = [
  { path: "docs/guide.md", change: "modify" },
  { path: "docs/new.md", change: "create" },
];

function firstRequest(sb: Sandbox, runId: string): { system: string; user: string } {
  const lines = readFileSync(path.join(sb.workspace, ".codaryn", "runs", runId, "journal.jsonl"), "utf8").split("\n").filter((line) => line.length > 0);
  const request = lines.map((line) => JSON.parse(line) as { type: string; system?: string; newMessages?: { content?: string }[] }).find((record) => record.type === "model_request");
  return { system: request?.system ?? "", user: request?.newMessages?.[0]?.content ?? "" };
}

/** After the apply: the plan, runs, report and a second apply, the same for both providers. */
async function checkAfter(sb: Sandbox, form: readonly string[], planRunId: string, digest: string, carriedRunId: string): Promise<void> {
  const plan = json(await runGuarded(sb, ["plan", ...form, "--run", planRunId, "--json"], cliEnv()));
  assert.equal(plan["status"], "applied");
  assert.deepEqual(plan["appliedBy"] !== null && (plan["appliedBy"] as { runId: string }).runId, carriedRunId);
  const runs = json(await runGuarded(sb, ["runs", "--workspace", sb.workspace, "--json"], cliEnv()));
  const entry = (runs["runs"] as { runId: string; planRunId?: string }[]).find((run) => run.runId === carriedRunId);
  assert.equal(entry?.planRunId, planRunId, "runs names the plan run of the carried run");
  const reportText = await runGuarded(sb, ["report", "--workspace", sb.workspace, "--run", carriedRunId], cliEnv());
  assert.ok(reportText.stdout.includes(`- Plan run: \`${planRunId}\`, digest \`${digest}\``), reportText.stdout);
  const reportJson = json(await runGuarded(sb, ["report", "--workspace", sb.workspace, "--run", carriedRunId, "--json"], cliEnv()));
  const result = reportJson["result"] as { planRunId?: string; planDigest?: string };
  assert.equal(result.planRunId, planRunId, "report --json keeps planRunId");
  assert.equal(result.planDigest, digest, "report --json keeps planDigest");
  const planReport = await runGuarded(sb, ["report", "--workspace", sb.workspace, "--run", planRunId], cliEnv());
  assert.ok(planReport.stdout.includes(`- Plan: 2 file(s) to write, carried out by run \`${carriedRunId}\``), planReport.stdout);
  const again = json(await runGuarded(sb, ["apply", ...form, "--run", planRunId, "--digest", digest.slice(0, 12)], cliEnv({ fakeApiKey: FAKE_API_KEY })));
  assert.equal(again["code"], "plan_already_applied", JSON.stringify(again));
}

describe("U-195 on the real CLI: a run plan from end to end", () => {
  test("scripted model: make, show, approve, carry out; result, runs, report; revert", { timeout: 120_000 }, async (t) => {
    const sb = createSandbox(t);
    writeWorkspaceFile(sb, "README.md", "# Title\n");
    writeWorkspaceFile(sb, "docs/guide.md", OLD_GUIDE);
    const config = writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, workflows: { rewrite: REWRITE } }, "c.json");
    const steps = [toolStep("read_file", { path: "docs/guide.md" }), toolStep("propose_changes", { summary: SUMMARY, files: PLANNED }), textStep("not requested")];
    const task = writeGeneralTask(sb, { id: "u195-cli", goal: GOAL, fields: { workflowRef: "rewrite" }, verifiers: CHECK }, steps);
    const form = ["--config", config, "--task", task];
    const made = json(await runGuarded(sb, ["run", ...form.slice(2), ...form.slice(0, 2)], cliEnv()));
    assert.equal(made["reason"], "plan_pending", JSON.stringify(made));
    const planRunId = made["runId"] as string;
    const digest = (made["plan"] as { digest: string; kind?: string }).digest;
    assert.equal((made["plan"] as { kind?: string }).kind, "changes");
    const shown = json(await runGuarded(sb, ["plan", ...form, "--run", planRunId, "--json"], cliEnv()));
    assert.equal(shown["planKind"], "changes");
    assert.deepEqual((shown["files"] as { path: string; change: string }[]).map((file) => `${file.change} ${file.path}`), ["modify docs/guide.md", "create docs/new.md"]);
    const text = await runGuarded(sb, ["plan", ...form, "--run", planRunId], cliEnv());
    assert.ok(text.stdout.includes("docs/new.md"), text.stdout);
    // The carrying run starts its own script at the first step.
    const carrying = [
      toolStep("write_file", { path: "docs/guide.md", expectedHash: sha256(OLD_GUIDE), change: { kind: "replace_all", content: "new guide\n" } }),
      toolStep("write_file", createFileArgs("docs/new.md", "new page\n")),
      textStep("done"),
    ];
    writeFileSync(sb.scriptPath, JSON.stringify({ schemaVersion: 1, steps: carrying }));
    const applied = await runGuarded(sb, ["apply", ...form, "--run", planRunId, "--digest", digest.slice(0, 12)], cliEnv());
    const result = json(applied);
    assert.equal(result["kind"], "run", applied.stdout);
    assert.equal(result["status"], "done", applied.stdout);
    assert.equal(result["planRunId"], planRunId);
    assert.equal(result["planDigest"], digest);
    assert.equal(readFileSync(path.join(sb.workspace, "docs", "guide.md"), "utf8"), "new guide\n");
    assert.equal(readFileSync(path.join(sb.workspace, "docs", "new.md"), "utf8"), "new page\n");
    const carriedRunId = result["runId"] as string;
    assert.equal(firstRequest(sb, carriedRunId).user, firstRequest(sb, planRunId).user, "the plan run's goal");
    assert.ok(firstRequest(sb, carriedRunId).system.includes(SUMMARY), "the approved plan in the system text");
    await checkAfter(sb, form, planRunId, digest, carriedRunId);
    const reverted = json(await runGuarded(sb, ["revert", "--workspace", sb.workspace, "--run", carriedRunId], cliEnv()));
    assert.equal(reverted["status"], "complete", JSON.stringify(reverted));
    assert.equal(readFileSync(path.join(sb.workspace, "docs", "guide.md"), "utf8"), OLD_GUIDE);
  });

  test("the fake Anthropic server: what each run was offered and told", { timeout: 120_000 }, async (t) => {
    const sb = createSandbox(t);
    writeWorkspaceFile(sb, "README.md", "# Title\n");
    writeWorkspaceFile(sb, "docs/guide.md", OLD_GUIDE);
    const api = await startFakeAnthropic(t, [
      replyTools([toolUse("toolu_r", "read_file", { path: "docs/guide.md" })]),
      replyTools([toolUse("toolu_c", "propose_changes", { summary: SUMMARY, files: PLANNED })]),
      replyText("not requested"),
    ]);
    const config = writeConfigFile(sb, { ...fakeApiConfig(api.url, { model: "cdy-u195-model", maxOutputTokens: 700, limits: ANTHROPIC_LIMITS }), workflows: { rewrite: REWRITE } }, "c.json");
    const task = writeAnthropicTask(sb, { id: "u195-api", goal: GOAL, extraTop: { workflowRef: "rewrite" }, verifiers: CHECK as unknown as VerifierConfig[] });
    const form = ["--config", config, "--task", task];
    const env = cliEnv({ fakeApiKey: FAKE_API_KEY });
    const made = json(await runGuarded(sb, ["run", "--task", task, "--config", config], env));
    assert.equal(made["reason"], "plan_pending", JSON.stringify(made));
    const planRunId = made["runId"] as string;
    const digest = (made["plan"] as { digest: string }).digest;
    const planRequests = messagesRequests(api).length;
    const second = await startFakeAnthropic(t, [
      replyTools([toolUse("toolu_w1", "write_file", { path: "docs/guide.md", expectedHash: sha256(OLD_GUIDE), change: { kind: "replace_all", content: "new guide\n" } })]),
      replyTools([toolUse("toolu_w2", "write_file", createFileArgs("docs/new.md", "new page\n") as Record<string, unknown>)]),
      replyText("done"),
    ]);
    writeConfigFile(sb, { ...fakeApiConfig(second.url, { model: "cdy-u195-model", maxOutputTokens: 700, limits: ANTHROPIC_LIMITS }), workflows: { rewrite: REWRITE } }, "c.json");
    const applied = await runGuarded(sb, ["apply", ...form, "--run", planRunId, "--digest", digest.slice(0, 12)], env);
    const result = json(applied);
    assert.equal(result["status"], "done", applied.stdout);
    assert.equal(result["planRunId"], planRunId);
    const toolNames = (request: unknown): string[] => ((bodyOf(request as never)["tools"] ?? []) as { name: string }[]).map((tool) => tool.name);
    assert.ok(planRequests >= 2);
    assert.ok(toolNames(messagesRequests(api)[0]).includes("propose_changes"), "the plan run is offered propose_changes");
    const carried = messagesRequests(second);
    assert.equal(carried.length, 3);
    for (const request of carried) {
      const names = toolNames(request);
      assert.ok(names.includes("write_file") && !names.includes("propose_changes") && !names.includes("propose_plan"), JSON.stringify(names));
    }
    const firstBody = JSON.stringify(bodyOf(carried[0] as never));
    assert.ok(firstBody.includes(SUMMARY), "the approved plan is told");
    assert.ok(firstBody.includes(GOAL), "the plan run's goal is the goal");
    await checkAfter(sb, form, planRunId, digest, result["runId"] as string);
  });
});

describe("U-195: plan_weakened names both plan modes", () => {
  test("a definition's run kept or refused; the old text for apply and none", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    const config = writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, workflows: { rewrite: REWRITE } }, "c.json");
    const message = async (fields: JsonObject, policy: JsonObject = {}): Promise<string> => {
      const task = writeGeneralTask(sb, { id: "u195-weak", fields, policy }, [textStep("done")]);
      return String(json(await runGuarded(sb, ["run", "--task", task, "--config", config], cliEnv()))["message"]);
    };
    assert.equal(await message({ workflowRef: "rewrite", plan: "none" }), 'plan cannot be "none" under a workflow with plan "run"');
    const organize = { planActions: ["move", "discard"] };
    assert.equal(await message({ workflowRef: "organize", plan: "none" }, organize), 'plan cannot be "none" under a workflow with plan "apply"');
    assert.equal(await message({ workflowRef: "organize", plan: "run" }, organize), 'plan cannot be "run" under a workflow with plan "apply"');
  });
});

describe("U-195: doctor warns when plan run and command rules come together (B-8)", () => {
  test("warn with plan_run_with_commands; with writablePaths too, that one first and this as a note", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    const script = path.join(sb.base, "tool.js");
    writeFileSync(script, "process.exit(0)\n");
    const rule = { ...nodeCommand(script) } as unknown as JsonObject;
    const config = writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, workflows: { rewrite: REWRITE } }, "c.json");
    const check = async (policy: JsonObject): Promise<{ status: string; text?: { id: string }; notes?: { id: string }[] }> => {
      const task = writeGeneralTask(sb, { id: "u195-doctor", fields: { workflowRef: "rewrite" }, policy }, [textStep("done")]);
      const output = json(await runGuarded(sb, ["doctor", "--task", task, "--config", config, "--json"], cliEnv()));
      const found = (output["checks"] as { id: string; status: string; text?: { id: string }; notes?: { id: string }[] }[]).find((entry) => entry.id === "commands");
      assert.ok(found !== undefined);
      return found;
    };
    const planRun = await check({ commands: [rule] });
    assert.equal(planRun.status, "warn");
    assert.equal(planRun.text?.id, "doctor.commands.plan_run_with_commands");
    const both = await check({ commands: [rule], writablePaths: ["docs"] });
    assert.equal(both.text?.id, "doctor.commands.writable_with_commands");
    assert.ok((both.notes ?? []).some((note) => note.id === "doctor.commands.plan_run_with_commands"), JSON.stringify(both));
    assert.equal((await check({})).status, "skipped", "no command rule: as before");
  });
});
