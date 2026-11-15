import assert from "node:assert/strict";
import { test } from "node:test";
import * as canonical from "../../../src/presentation/json.js";
import * as guard from "../../../src/cli/guard.js";
import * as plan from "../../../src/cli/plan-commands.js";
import type { CommandOutcome, JsonOutcome, StdoutContext } from "../../../src/cli/guard.js";
import type { CommandOutcome as AppCommandOutcome, JsonOutcome as AppJsonOutcome } from "../../../src/app/command-outcome.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type PublicContracts = [
  Expect<Equal<keyof typeof canonical, "jsonLine">>,
  Expect<Equal<typeof canonical.jsonLine, (value: unknown) => string>>,
  Expect<Equal<typeof canonical.jsonLine, typeof guard.jsonLine>>,
  Expect<Equal<typeof canonical.jsonLine, typeof plan.planJsonLine>>,
  Expect<Equal<Parameters<typeof canonical.jsonLine>, [value: unknown]>>,
  Expect<Equal<ReturnType<typeof canonical.jsonLine>, string>>,
  Expect<Equal<CommandOutcome, AppCommandOutcome>>,
  Expect<Equal<JsonOutcome, AppJsonOutcome>>,
  Expect<Equal<StdoutContext, {
    readonly argv: readonly string[];
    readonly stdoutIsTerminal: boolean;
    readonly stderrIsTerminal: boolean;
  }>>,
];

// Both directions must compile; unknown input and string output must not be narrowed or erased.
const canonicalToLegacy: typeof guard.jsonLine = canonical.jsonLine;
const legacyToCanonical: typeof canonical.jsonLine = guard.jsonLine;
const canonicalToPlan: typeof plan.planJsonLine = canonical.jsonLine;
const planToCanonical: typeof canonical.jsonLine = plan.planJsonLine;
const contracts: PublicContracts = [true, true, true, true, true, true, true, true, true];

test("JSON presentation exposes one canonical binding shared by both legacy entry points", () => {
  assert.deepEqual(Object.keys(canonical), ["jsonLine"]);
  assert.equal(canonical.jsonLine, guard.jsonLine);
  assert.equal(canonical.jsonLine, plan.planJsonLine);
  assert.equal(canonicalToLegacy, legacyToCanonical);
  assert.equal(canonicalToPlan, planToCanonical);
  assert.equal(contracts.length, 9);
});

test("JSON extraction preserves the complete legacy guard and plan runtime namespaces", () => {
  assert.deepEqual(Object.keys(guard).sort(), [
    "UNEXPECTED_ERROR_MESSAGE", "jsonLine", "jsonLineLeftOut", "renderOutcome",
    "runGuarded", "runGuardedCommand", "stdoutText",
  ]);
  assert.deepEqual(Object.keys(plan).sort(), [
    "NO_GOAL", "applyChangesPlan", "applyQuestion", "latestPlanRule", "planJsonLine",
    "renderPlan", "renderReview", "runApply", "runPlan", "runReview", "unsafeMoveQuestion",
  ]);
});

test("jsonLine retains an ordinary synchronous function and the same prototype and constructor", () => {
  const prototype = Object.getOwnPropertyDescriptor(canonical.jsonLine, "prototype");
  assert.ok(prototype);
  assert.equal(prototype.writable, true);
  assert.equal(prototype.enumerable, false);
  assert.equal(prototype.configurable, false);
  assert.equal(prototype.value.constructor, canonical.jsonLine);
  for (const fn of [canonical.jsonLine, guard.jsonLine, plan.planJsonLine]) {
    assert.equal(fn.name, "jsonLine");
    assert.equal(fn.length, 1);
    assert.equal(fn.constructor, Function);
    assert.equal(Object.getPrototypeOf(fn), Function.prototype);
    assert.equal(Object.getOwnPropertyDescriptor(fn, "prototype")?.value, prototype.value);
    // This exercises constructibility without executing the serialization function.
    const instance = Reflect.construct(function () {}, [], fn);
    assert.equal(Object.getPrototypeOf(instance), prototype.value);
  }
});
