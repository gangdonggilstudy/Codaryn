/**
 * U-109 (review R-79 L-1, design Q-2): a command rule with `confirm: true` ("ask before running")
 * is the user's own: the contract lets the config file's `policy` and each profile's `policy` hold it
 * (ConfirmablePolicyConfig), but the CLI's parsePolicy refused it everywhere. Now it is taken from
 * those two places only. A task file and a task type's definition still refuse it as an unknown
 * field, and `confirm: false` is refused wherever it stands (only `true` means anything).
 * The CLI has no way to ask yet, so a call that only such a rule allows is refused without a
 * question (`confirmation_required`), as the engine does with no one to ask: the question and its
 * default answer are recorded, the command does not run. A call that a rule without `confirm`
 * allows runs as before.
 * The real CLI (dist/src/cli/main.js) under the network guard, against the loopback fake Anthropic
 * server; fake key; each command, if it ran, would write a marker file into the workspace.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import type { TestContext } from "node:test";
import type { CliErrorOutput, EngineResult, JournalRecord } from "../../../src/contracts/index.js";
import { cliEnv } from "../../support/cli.js";
import { replyText, replyTools, runGuarded, startFakeAnthropic, toolUse } from "../../support/fake-anthropic.js";
import { ANTHROPIC_LIMITS, fakeApiConfig, writeConfigFile } from "../../fixtures/anthropic.js";
import { createSandbox } from "../../fixtures/builders.js";
import type { Sandbox } from "../../fixtures/builders.js";
import { FAKE_API_KEY } from "../../fixtures/secrets.js";

const NODE = process.execPath;
const MODEL = "fake-model-u109";
const POLICY = { network: "deny", destructive: "deny", restorePathTokens: false } as const;
/** `mark.mjs` runs on a plain rule; `ask.mjs` only on a rule that asks first. */
const RULES = [
  { executable: NODE, argsPrefix: ["mark.mjs"], allowExtraArgs: false },
  { executable: NODE, argsPrefix: ["ask.mjs"], allowExtraArgs: false, confirm: true },
];

/** The two scripts in the workspace, each writing its own marker when it runs. */
function scripts(sb: Sandbox): void {
  for (const name of ["mark", "ask"]) {
    writeFileSync(join(sb.workspace, `${name}.mjs`), `import { writeFileSync } from "node:fs";\nwriteFileSync("${name}-ran.txt", "ran\\n");\n`);
  }
}

/** The model calls both commands in one turn, then ends. */
async function api(t: TestContext) {
  return startFakeAnthropic(t, [
    replyTools([toolUse("toolu_m1", "run_command", { executable: NODE, args: ["mark.mjs"] }), toolUse("toolu_a1", "run_command", { executable: NODE, args: ["ask.mjs"] })]),
    replyText("done"),
  ]);
}

function journalOf(sb: Sandbox, result: EngineResult): JournalRecord[] {
  const file = join(sb.workspace, ".codaryn", "runs", result.runId, "journal.jsonl");
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as JournalRecord);
}

/** What the quick form did with the two calls. */
async function quickRun(t: TestContext, config: (url: string) => object, extraArgs: readonly string[] = []) {
  const sb = createSandbox(t);
  scripts(sb);
  const fake = await api(t);
  const configPath = writeConfigFile(sb, config(fake.url));
  const run = await runGuarded(sb, ["run", "--config", configPath, "--workspace", sb.workspace, "--goal", "run the two scripts", ...extraArgs], cliEnv({ fakeApiKey: FAKE_API_KEY }));
  const result = JSON.parse(run.stdout.trim()) as EngineResult;
  assert.equal(result.kind, "run", run.stdout.slice(0, 2000) + run.stderr.slice(0, 2000));
  return { sb, fake, run, result, journal: journalOf(sb, result) };
}

type Decision = Extract<JournalRecord, { type: "tool_decision" }>;

function assertAskedNobody(sb: Sandbox, journal: readonly JournalRecord[]): void {
  const decisions = journal.filter((record): record is Decision => record.type === "tool_decision");
  /** The call's last decision, the one that let it run or not. */
  const of = (callId: string): Decision | undefined => decisions.filter((record) => record.callId === callId).at(-1);
  // The plain rule's call runs without a question.
  assert.deepEqual([of("toolu_m1")?.allowed, of("toolu_m1")?.code], [true, null], JSON.stringify(decisions));
  assert.equal(existsSync(join(sb.workspace, "mark-ran.txt")), true, "the plain rule's command ran");
  // The asking rule's call: the question is recorded, nobody can answer, it is refused and does not run.
  const requested = journal.filter((record) => record.type === "confirmation_requested");
  assert.deepEqual(requested.map((record) => record.type === "confirmation_requested" && [record.callId, record.permission, record.argumentCount]), [["toolu_a1", "command", 1]]);
  const answered = journal.filter((record) => record.type === "confirmation_answered");
  assert.deepEqual(answered.map((record) => record.type === "confirmation_answered" && [record.decision, record.by]), [["deny", "default"]]);
  assert.deepEqual([of("toolu_a1")?.allowed, of("toolu_a1")?.permission, of("toolu_a1")?.code], [false, "command", "confirmation_required"], JSON.stringify(decisions));
  assert.equal(existsSync(join(sb.workspace, "ask-ran.txt")), false, "the asking rule's command did not run");
  const result = journal.find((record) => record.type === "tool_result" && record.result.callId === "toolu_a1");
  assert.ok(result?.type === "tool_result" && result.result.content.includes("command/confirmation_required"), JSON.stringify(result));
}

describe("U-109 (R-79 L-1): confirm: true is taken from the config's policy and its profiles' only", () => {
  test("the config's policy: the plain rule's command runs, the asking rule's is refused without a question", async (t) => {
    const { sb, fake, journal } = await quickRun(t, (url) => fakeApiConfig(url, { model: MODEL, limits: ANTHROPIC_LIMITS, policy: { commands: RULES, ...POLICY } } as object));
    assert.equal(fake.requests.length, 2, "the model was asked twice: the calls, then the end");
    assertAskedNobody(sb, journal);
  });

  test("a profile's policy: the same", async (t) => {
    const { sb, journal } = await quickRun(
      t,
      (url) => fakeApiConfig(url, { model: MODEL, limits: ANTHROPIC_LIMITS, profiles: { ask: { policy: { commands: RULES, ...POLICY } } } } as object),
      ["--profile", "ask"],
    );
    assertAskedNobody(sb, journal);
  });

  test("doctor reads such a config: the config file is valid", async (t) => {
    const sb = createSandbox(t);
    const configPath = writeConfigFile(sb, fakeApiConfig("http://127.0.0.1:9", { model: MODEL, limits: ANTHROPIC_LIMITS, policy: { commands: RULES, ...POLICY } } as object));
    const run = await runGuarded(sb, ["doctor", "--config", configPath, "--workspace", sb.workspace, "--json"], cliEnv({ fakeApiKey: FAKE_API_KEY }));
    const output = JSON.parse(run.stdout.trim()) as { checks: { id: string; status: string }[] };
    assert.equal(output.checks.find((check) => check.id === "config_file")?.status, "ok", run.stdout);
  });
});

describe("U-109 (R-79 L-1): elsewhere, and confirm other than true, are refused before anything is sent", () => {
  async function refused(t: TestContext, write: (sb: Sandbox, url: string) => readonly string[]): Promise<CliErrorOutput & { diagnostic?: { code: string; field: string | null } }> {
    const sb = createSandbox(t);
    scripts(sb);
    const fake = await api(t);
    const run = await runGuarded(sb, write(sb, fake.url), cliEnv({ fakeApiKey: FAKE_API_KEY }));
    assert.equal(fake.requests.length, 0, "nothing was sent");
    assert.equal(run.exitCode, 2, run.stdout);
    return JSON.parse(run.stdout.trim()) as CliErrorOutput & { diagnostic?: { code: string; field: string | null } };
  }
  const quick = (sb: Sandbox, configPath: string): readonly string[] => ["run", "--config", configPath, "--workspace", sb.workspace, "--goal", "g"];
  const config = (url: string, extra: object): object => fakeApiConfig(url, { model: MODEL, limits: ANTHROPIC_LIMITS, ...extra } as object);

  test("a task file's command rule: invalid_task, unknown field, as before", async (t) => {
    const output = await refused(t, (sb, url) => {
      const task = { schemaVersion: 1, id: "u109", goal: "g", workflow: "code", workspaceRoot: "./ws", model: { provider: "anthropic", model: MODEL }, policy: { commands: RULES, ...POLICY }, privacy: { secretEnv: [] }, limits: ANTHROPIC_LIMITS, verifiers: [] };
      writeFileSync(sb.taskPath, JSON.stringify(task));
      return ["run", "--task", sb.taskPath, "--config", writeConfigFile(sb, config(url, {}))];
    });
    assert.deepEqual([output.code, output.diagnostic?.code, output.diagnostic?.field], ["invalid_task", "unknown_field", "policy.commands[1]"], JSON.stringify(output));
  });

  test("a task type's definition in the config: invalid_config, unknown field, as before", async (t) => {
    const definition = { tools: ["read_file", "run_command"], policy: { commands: RULES, ...POLICY } };
    const output = await refused(t, (sb, url) => quick(sb, writeConfigFile(sb, config(url, { workflows: { asking: definition } }))));
    assert.equal(output.code, "invalid_config", JSON.stringify(output));
    assert.match(output.message, /^workflows\[0\]\.policy\.commands\[1\] has an unknown field/, JSON.stringify(output));
  });

  for (const [name, value] of [
    ["false", false],
    ["a string", "yes"],
  ] as const) {
    // The diagnostic names the rule (`confirm` is not among the contract's schema field names yet).
    test(`confirm ${name} in the config's policy: invalid_config, an invalid value in the rule`, async (t) => {
      const rules = [{ ...RULES[0], confirm: value }];
      const output = await refused(t, (sb, url) => quick(sb, writeConfigFile(sb, config(url, { policy: { commands: rules, ...POLICY } }))));
      assert.deepEqual([output.code, output.diagnostic?.code, output.diagnostic?.field], ["invalid_config", "invalid_value", "policy.commands[0]"], JSON.stringify(output));
      assert.equal(output.message, "policy.commands[0].confirm must be true when it is given");
    });
  }

  test("confirm false in a profile's policy: invalid_config", async (t) => {
    const rules = [{ ...RULES[0], confirm: false }];
    const output = await refused(t, (sb, url) => [...quick(sb, writeConfigFile(sb, config(url, { profiles: { ask: { policy: { commands: rules, ...POLICY } } } }))), "--profile", "ask"]);
    assert.equal(output.code, "invalid_config", JSON.stringify(output));
    assert.match(output.message, /^profiles\[0\]\.policy\.commands\[0\]\.confirm /, JSON.stringify(output));
  });
});
