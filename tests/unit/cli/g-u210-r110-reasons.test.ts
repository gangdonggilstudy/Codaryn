/**
 * U-210, nc-human's review R-110 of the bundle A board:
 * - M-1: a run refused for bundle A's settings told a person only that a field "has an invalid value";
 *   the reason was in the JSON message only, and doctor said the same. Now the error has a hint whose
 *   line says why (CliErrorOutput.hint, listed `error.hint.<hint>`), and doctor's failed check has a
 *   note that says why:
 *   - analyze-private with no unreadable path in the run: hint unreadable_paths_required, doctor's note
 *     doctor.private_data.unreadable_paths_required;
 *   - a command rule or a command verifier with unreadable paths: hint unreadable_with_commands, also
 *     where analyze-private refuses the task's own rule as commands_not_allowed (the run has unreadable
 *     paths); organize's commands_not_allowed without them is as before;
 *   - k out of 5 to 1000, in a task file, the config file or a profile: hint min_group_size_range,
 *     doctor's note doctor.private_data.min_group_size_range.
 *   The JSON codes and messages are as before.
 * - L-2: the hidden-groups line's last clause was true of whole groups only; a value left out
 *   (fewCells) is not "only how many groups were left out". It now says neither was given.
 * - L-3: codaryn review printed analyze-private's checklist item in English in every language; it
 *   now shows it through builtinReviewItemText, as the end summary does.
 * Real CLI, scripted model, temporary folders.
 */

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { MessageId } from "../../../src/contracts/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { cliEnv } from "../../support/cli.js";
import type { CliRun } from "../../support/cli.js";
import { runGuarded } from "../../support/fake-anthropic.js";
import { writeConfigFile } from "../../fixtures/anthropic.js";
import { createSandbox, nodeCommand, writeWorkspaceFile } from "../../fixtures/builders.js";
import type { Sandbox } from "../../fixtures/builders.js";
import { textStep, toolStep, writeGeneralTask } from "../../fixtures/general-tasks.js";

const POLICY = { commands: [], network: "deny", destructive: "deny", restorePathTokens: false };
const LIMITS = { maxModelTurns: 8, maxToolCalls: 24, maxTotalTokens: 1000, maxDurationMs: 60_000 };

const text = (lang: "en" | "ko", id: string, params?: Record<string, unknown>): string =>
  (createMessageCatalog(lang).format as (id: MessageId, params?: unknown) => string)(id as MessageId, params);
const json = (run: CliRun): Record<string, unknown> => JSON.parse(run.stdout.trim().split("\n").pop() ?? "") as Record<string, unknown>;

function commandRule(sb: Sandbox): Record<string, unknown> {
  const script = path.join(sb.base, "tool.js");
  writeFileSync(script, "process.exit(0)\n");
  return { ...nodeCommand(script), argsPrefix: [script] };
}

interface DoctorCheck {
  readonly id: string;
  readonly status: string;
  readonly text?: { readonly id: string };
  readonly notes?: readonly { readonly id: string }[];
}
async function doctorCheck(sb: Sandbox, args: readonly string[], id: string): Promise<DoctorCheck> {
  const ran = await runGuarded(sb, ["doctor", ...args, "--json"], cliEnv());
  const found = (JSON.parse(ran.stdout) as { checks: DoctorCheck[] }).checks.find((check) => check.id === id);
  assert.ok(found !== undefined, ran.stdout);
  return found;
}
const noteIds = (check: DoctorCheck): string[] => (check.notes ?? []).map((note) => note.id);

describe("U-210 (R-110 M-1): a refusal for bundle A's settings says why, to a person and in doctor", () => {
  test("analyze-private without an unreadable path: the hint line in both languages; doctor's note", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    writeWorkspaceFile(sb, "README.md", "# Title\n");
    const task = writeGeneralTask(sb, { id: "r110-required", fields: { workflowRef: "analyze-private" } }, [textStep("not requested")]);
    for (const lang of ["en", "ko"] as const) {
      const ran = await runGuarded(sb, ["run", "--task", task], cliEnv({ extra: { CODARYN_LANG: lang } }));
      const output = json(ran);
      assert.deepEqual([output["code"], output["hint"]], ["invalid_task", "unreadable_paths_required"], ran.stdout);
      assert.match(String(output["message"]), /^policy\.unreadablePaths must not be empty under the analyze-private task type/);
      assert.ok(ran.stderr.includes(text(lang, "error.hint.unreadable_paths_required")), ran.stderr);
    }
    const check = await doctorCheck(sb, ["--task", task], "task_file");
    assert.equal(check.status, "fail");
    assert.deepEqual(noteIds(check), ["doctor.private_data.unreadable_paths_required"]);
  });

  test("a command rule or a command verifier with unreadable paths: the hint; analyze-private's own rule too; organize as before", { timeout: 90_000 }, async (t) => {
    const sb = createSandbox(t);
    writeWorkspaceFile(sb, "README.md", "# Title\n");
    const rule = commandRule(sb);
    const config = writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, policy: { ...POLICY, unreadablePaths: ["private"] } }, "c.json");
    const withRule = writeGeneralTask(sb, { id: "r110-rule", policy: { commands: [rule] as never } }, [textStep("not requested")]);
    const ruled = await runGuarded(sb, ["run", "--task", withRule, "--config", config], cliEnv());
    assert.deepEqual([json(ruled)["code"], json(ruled)["hint"]], ["invalid_task", "unreadable_with_commands"], ruled.stdout);
    assert.match(String(json(ruled)["message"]), /^policy\.commands must be empty while unreadablePaths is set/);
    assert.ok(ruled.stderr.includes(text("en", "error.hint.unreadable_with_commands")), ruled.stderr);
    const verifier = { id: "check", kind: "command", executable: rule["executable"], args: rule["argsPrefix"] };
    const withVerifier = writeGeneralTask(sb, { id: "r110-verifier", verifiers: [verifier] as never }, [textStep("not requested")]);
    assert.equal(json(await runGuarded(sb, ["run", "--task", withVerifier, "--config", config], cliEnv()))["hint"], "unreadable_with_commands");
    // analyze-private refuses the task's own rule first as commands_not_allowed; the run has unreadable paths.
    const privateRule = writeGeneralTask(sb, { id: "r110-private-rule", fields: { workflowRef: "analyze-private" }, policy: { commands: [rule] as never } }, [textStep("not requested")]);
    const refused = json(await runGuarded(sb, ["run", "--task", privateRule, "--config", config], cliEnv()));
    assert.deepEqual([refused["code"], refused["message"], refused["hint"]], ["invalid_task", "policy.commands must be empty: the workflow allows no command", "unreadable_with_commands"]);
    // organize without unreadable paths: commands_not_allowed with no hint, as before.
    const organize = writeGeneralTask(sb, { id: "r110-organize", fields: { workflowRef: "organize" }, policy: { commands: [rule] as never, planActions: ["move"] as never } }, [textStep("not requested")]);
    const before = json(await runGuarded(sb, ["run", "--task", organize], cliEnv()));
    assert.deepEqual([before["code"], before["hint"]], ["invalid_task", undefined], JSON.stringify(before));
  });

  test("k out of 5 to 1000 in a task file, the config file or a profile: the hint; doctor's note", { timeout: 90_000 }, async (t) => {
    const sb = createSandbox(t);
    writeWorkspaceFile(sb, "README.md", "# Title\n");
    const low = writeGeneralTask(sb, { id: "r110-k", policy: { minGroupSize: 3 } }, [textStep("not requested")]);
    const ran = await runGuarded(sb, ["run", "--task", low], cliEnv({ extra: { CODARYN_LANG: "ko" } }));
    assert.deepEqual([json(ran)["code"], json(ran)["hint"], json(ran)["message"]], ["invalid_task", "min_group_size_range", "policy.minGroupSize must be a whole number from 5 to 1000"]);
    assert.ok(ran.stderr.includes(text("ko", "error.hint.min_group_size_range")), ran.stderr);
    assert.deepEqual(noteIds(await doctorCheck(sb, ["--task", low], "task_file")), ["doctor.private_data.min_group_size_range"]);
    const plain = writeGeneralTask(sb, { id: "r110-plain" }, [textStep("not requested")]);
    const config = writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, policy: { ...POLICY, minGroupSize: 2000 } }, "k.json");
    const configRun = json(await runGuarded(sb, ["run", "--task", plain, "--config", config], cliEnv()));
    assert.deepEqual([configRun["code"], configRun["hint"]], ["invalid_config", "min_group_size_range"], JSON.stringify(configRun));
    const configCheck = await doctorCheck(sb, ["--task", plain, "--config", config], "config_file");
    assert.deepEqual([configCheck.status, noteIds(configCheck)], ["fail", ["doctor.private_data.min_group_size_range"]]);
    const profiled = writeConfigFile(sb, { schemaVersion: 1, limits: LIMITS, profiles: { p: { policy: { ...POLICY, minGroupSize: 1 } } } }, "p.json");
    const profileRun = json(await runGuarded(sb, ["run", "--task", plain, "--config", profiled], cliEnv()));
    assert.deepEqual([profileRun["code"], profileRun["hint"]], ["invalid_config", "min_group_size_range"], JSON.stringify(profileRun));
  });
});

describe("U-210 (R-110 L-2, L-3): the hidden-groups line and review's checklist", () => {
  test("the hidden-groups line says neither the groups nor the values were given", () => {
    assert.match(text("en", "summary.groups_hidden", { results: 2, k: 5 }), /neither those groups nor those values/);
    assert.match(text("ko", "summary.groups_hidden", { results: 2, k: 5 }), /그 묶음도 그 값도/);
  });

  test("codaryn review shows analyze-private's item in the chosen language", { timeout: 60_000 }, async (t) => {
    const sb = createSandbox(t);
    writeWorkspaceFile(sb, "private/people.csv", "id,amount\na,1\n");
    const task = writeGeneralTask(sb, { id: "r110-review", fields: { workflowRef: "analyze-private" }, policy: { unreadablePaths: ["private"] } }, [
      toolStep("query_table", { path: "private/people.csv", describe: true }),
      textStep("done"),
    ]);
    const ran = json(await runGuarded(sb, ["run", "--task", task], cliEnv()));
    assert.equal(ran["reason"], "awaiting_review", JSON.stringify(ran));
    const reviewed = await runGuarded(sb, ["review", "--task", task, "--run", String(ran["runId"]), "--accept"], cliEnv({ extra: { CODARYN_LANG: "ko" } }));
    const shown = `${reviewed.stdout}\n${reviewed.stderr}`;
    assert.ok(shown.includes(`3. ${text("ko", "review.item.no_identifying_values")}`), shown);
    assert.equal(shown.includes("No value in the result table or the report can identify a person."), false, shown);
  });
});
