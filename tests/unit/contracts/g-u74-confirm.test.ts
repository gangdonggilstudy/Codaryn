/**
 * U-74 (DR-1, DR-3, DR-10, adapter-contract 5.9; survey 4 and 8 B-1): the contract of the in-run
 * permission question, before the policy (B-2) and the engine (B-3) use it. Only a command rule of
 * the user's config file or a profile may say `confirm: true`; a task file's policy and a task type
 * definition's rules cannot (their rule type has no such field, so the schema refuses it). The
 * policy's "confirm" result is a denial with a mark, so a part that does not know it denies. Nobody
 * to ask, or no answer: denied, recorded `by: "default"`. The question holds fixed words, the tool,
 * the masked executable name and the number of arguments, never the model's argument text.
 * Without any confirm rule nothing changes.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CONFIRM_ANSWER_DECISIONS,
  CONFIRM_ID_PATTERN_SOURCE,
  CONFIRMATION_BY,
  CONFIRMATION_DECISIONS,
  FIXED_MESSAGES,
  MESSAGE_IDS,
  POLICY_DENIAL_CODES,
  REFUSAL_HINTS,
  mergeWorkflowPolicy,
  messageParams,
} from "../../../src/contracts/index.js";
import type {
  CodarynConfig,
  ConfigProfile,
  ConfirmAnswer,
  ConfirmPermission,
  ConfirmRequest,
  ConfirmablePolicyConfig,
  EngineDeps,
  JournalEvent,
  MaskedText,
  MessageId,
  PolicyConfig,
  PolicyDecision,
  ResolvedTaskSpec,
  TaskSpec,
  WorkflowDefinition,
} from "../../../src/contracts/index.js";

const RULE = { executable: "npm", argsPrefix: ["test"], allowExtraArgs: false } as const;
const ASKED = { ...RULE, confirm: true } as const;
const base = { network: "deny", destructive: "deny", restorePathTokens: false } as const;

describe("U-74: who may ask", () => {
  test("a config file and a profile may mark a command rule confirm: true", () => {
    const policy: ConfirmablePolicyConfig = { ...base, commands: [ASKED, RULE] };
    const config: Pick<CodarynConfig, "policy"> = { policy };
    const profile: Pick<ConfigProfile, "policy"> = { policy };
    const resolved: Pick<ResolvedTaskSpec, "policy"> = { policy };
    assert.ok(config && profile && resolved);
  });

  test("a task file's policy and a task type definition's rules cannot", () => {
    // The rule as a task file or a definition would write it: its type has no `confirm`.
    // @ts-expect-error a task file cannot make a question (M-9)
    const task: Pick<TaskSpec, "policy"> = { policy: { ...base, commands: [{ executable: "npm", argsPrefix: [], allowExtraArgs: false, confirm: true }] } };
    // @ts-expect-error a task type definition's rules are its safety rules; they cannot ask
    const definition: Pick<WorkflowDefinition, "policy"> = { policy: { ...base, commands: [{ executable: "npm", argsPrefix: [], allowExtraArgs: false, confirm: true }] } };
    const plain: PolicyConfig = { ...base, commands: [RULE] };
    const widened: ConfirmablePolicyConfig = plain;
    assert.ok(task && definition && widened);
  });

  test("merging with a task type definition keeps the configured rule's confirm (no ask turns into an allow)", () => {
    const definition: PolicyConfig = { ...base, commands: [{ executable: "npm", argsPrefix: [], allowExtraArgs: true }] };
    const merged = mergeWorkflowPolicy(definition, { ...base, commands: [ASKED, { executable: "npm", argsPrefix: ["run", "lint"], allowExtraArgs: false }] });
    assert.deepEqual(merged?.commands, [ASKED, { executable: "npm", argsPrefix: ["run", "lint"], allowExtraArgs: false }]);
    const noConfirm = mergeWorkflowPolicy(definition, { ...base, commands: [RULE] });
    assert.deepEqual(noConfirm?.commands, [RULE], "without confirm the merged rule is as before, with no confirm key");
    assert.equal(Object.hasOwn(noConfirm?.commands[0] ?? {}, "confirm"), false);
  });
});

describe("U-74: the policy's confirm result, the question and the answer", () => {
  test("confirm is a denial with a mark and its own code, which has a hint for the model", () => {
    // U-175 added path_not_writable after it; the codes before it keep their places.
    assert.equal(POLICY_DENIAL_CODES.indexOf("confirmation_required"), POLICY_DENIAL_CODES.indexOf("plan_action_not_allowed") + 1);
    const decision: PolicyDecision = { allowed: false, permission: "command", code: "confirmation_required", confirm: true };
    assert.equal(decision.allowed, false, "a part that does not know the mark denies");
    assert.equal(typeof REFUSAL_HINTS.confirmation_required, "string");
    assert.ok((MESSAGE_IDS as readonly string[]).includes("denial.confirmation_required"));
  });

  test("the request: fixed fields, the masked executable and the number of arguments; no argument text", () => {
    const request: ConfirmRequest = {
      kind: "permission",
      id: "q1",
      callId: "c1",
      tool: "run_command",
      permission: "command",
      subject: "npm" as MaskedText,
      argumentCount: 2,
    };
    assert.match(request.id, new RegExp(CONFIRM_ID_PATTERN_SOURCE));
    assert.equal(new RegExp(CONFIRM_ID_PATTERN_SOURCE).test("q0"), false);
    // @ts-expect-error the request never carries the model's arguments
    const withArgs: ConfirmRequest = { ...request, args: ["test", "--watch"] };
    assert.ok(withArgs);
  });

  test("answers and what is recorded: dismissed is recorded as deny by default", () => {
    assert.deepEqual([...CONFIRM_ANSWER_DECISIONS], ["allow_once", "deny", "dismissed"]);
    assert.deepEqual([...CONFIRMATION_DECISIONS], ["allow_once", "deny"]);
    assert.deepEqual([...CONFIRMATION_BY], ["user", "default", "cancelled"]);
    const answers: ConfirmAnswer[] = [{ decision: "allow_once" }, { decision: "deny" }, { decision: "dismissed" }];
    assert.equal(answers.length, 3);
    const events: JournalEvent[] = [
      { type: "confirmation_requested", id: "q1", kind: "permission", callId: "c1", tool: "run_command", permission: "command", subject: "npm" as MaskedText, argumentCount: 2 },
      { type: "confirmation_answered", id: "q1", decision: "deny", by: "default" },
    ];
    assert.equal(events.length, 2);
    // @ts-expect-error dismissed is never recorded as such
    const dismissed: JournalEvent = { type: "confirmation_answered", id: "q1", decision: "dismissed", by: "user" };
    assert.ok(dismissed);
  });

  test("EngineDeps.confirm is optional: a run without it asks nobody and denies by default", () => {
    const confirm: ConfirmPermission = async () => ({ decision: "dismissed" });
    const withConfirm: Pick<EngineDeps, "confirm"> = { confirm };
    const without: Pick<EngineDeps, "confirm"> = {};
    assert.ok(withConfirm && without);
  });

  test("the human texts: the question, and the progress line of each answer", () => {
    assert.deepEqual(messageParams("confirm.question.command" as MessageId), { count: "count" });
    assert.ok(Object.hasOwn(FIXED_MESSAGES, "confirm.question.command"));
    const ids = MESSAGE_IDS as readonly string[];
    assert.ok(ids.includes("progress.confirmation_allowed"));
    for (const by of CONFIRMATION_BY) {
      assert.ok(ids.includes(`progress.confirmation_denied.${by}`), by);
      assert.deepEqual(messageParams(`progress.confirmation_denied.${by}` as MessageId), {});
    }
  });
});
