/**
 * K3: the engine's integrity checks (U-1, U-2, docs/work-orders/phase-3-self-development.md).
 * Contract stand-ins only: a fake IntegrityChecker that follows the `compare` rules of
 * src/contracts/integrity.ts over an in-memory "world", fake model, tools and verifiers, and a fake
 * privacy gateway (FAKE_SECRET → FAKE_TOKEN). Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { RUN_EXIT_CODES, asRawText } from "../../../src/contracts/index.js";
import type {
  ContentHash,
  EngineDeps,
  IntegrityChecker,
  IntegrityEntry,
  IntegrityManifest,
  IntegrityPhase,
  RawText,
  RawVerifierResult,
  ToolCall,
  VerifierConfig,
  VerifierOutcome,
} from "../../../src/contracts/index.js";
import { FIXED_MODEL_TEXTS, INTEGRITY_NOTICE_PATHS, runTask } from "../../../src/engine/index.js";
import {
  FAKE_SECRET,
  FAKE_TOKEN,
  FakeClock,
  FakeTools,
  FakeVerifiers,
  fakePrivacy,
  finalAnswer,
  harness,
  response,
} from "./fakes.js";
import type { Harness, TaskOverrides } from "./fakes.js";

type WorldEntry =
  | { readonly kind: "file" | "link"; readonly sha256: ContentHash }
  | { readonly kind: "absent" }
  | { readonly kind: "unchecked"; readonly why: "unreadable" | "limit" };

const SHA_1 = "1".repeat(64);
const SHA_2 = "2".repeat(64);
const TEST_FILE = "tests/sum.test.mjs";
const EXTERNAL_FILE = "D:/baseline/verify.json";

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** IntegrityChecker stand-in. `compare` follows the contract comment of IntegrityChecker.compare. */
class FakeIntegrity implements IntegrityChecker {
  readonly world = new Map<string, WorldEntry>();
  captures = 0;
  /** 1-based capture number that rejects (an unexpected failure, not a file-level problem). */
  failOn: number | null = null;
  /** Runs inside a capture, before the world is read. */
  onCapture: ((index: number) => void) | null = null;

  constructor(initial: Record<string, WorldEntry> = { [TEST_FILE]: { kind: "file", sha256: SHA_1 } }) {
    for (const [path, entry] of Object.entries(initial)) this.world.set(path, entry);
  }

  change(path: string, sha256: ContentHash = SHA_2): void {
    this.world.set(path, { kind: "file", sha256 });
  }

  async capture(): Promise<IntegrityManifest> {
    this.captures += 1;
    this.onCapture?.(this.captures);
    if (this.failOn === this.captures) throw new Error("capture failed");
    const entries = [...this.world.entries()]
      .sort(([a], [b]) => byCodeUnit(a, b))
      .map(([path, entry]) => ({ path: asRawText(path), ...entry }) as IntegrityEntry);
    return { entries };
  }

  compare(before: IntegrityManifest, after: IntegrityManifest): readonly RawText[] {
    const first = new Map(before.entries.map((entry) => [entry.path as string, entry]));
    const second = new Map(after.entries.map((entry) => [entry.path as string, entry]));
    const changed = new Set<string>();
    for (const path of new Set([...first.keys(), ...second.keys()])) {
      const a = first.get(path);
      const b = second.get(path);
      if (a === undefined || b === undefined || a.kind === "unchecked" || b.kind === "unchecked" || a.kind !== b.kind) {
        changed.add(path);
      } else if ("sha256" in a && "sha256" in b && a.sha256 !== b.sha256) {
        changed.add(path);
      }
    }
    return [...changed].sort(byCodeUnit).map(asRawText);
  }
}

/** Verifier stand-in whose run can act on the world (a verifier command that writes files). */
class HookVerifiers {
  readonly runs: string[] = [];
  constructor(
    private readonly outcome: (config: VerifierConfig, round: number) => VerifierOutcome,
    private readonly hook: (config: VerifierConfig, round: number) => void = () => {},
  ) {}
  async run(config: VerifierConfig): Promise<RawVerifierResult> {
    const round = this.runs.filter((id) => id === config.id).length;
    this.runs.push(config.id);
    this.hook(config, round);
    return {
      id: config.id,
      kind: config.kind,
      outcome: this.outcome(config, round),
      evidence: asRawText(`round ${round}`),
      checked: ["the configured rule"],
      limits: [],
    };
  }
}

const runCommand = (id: string): ToolCall => ({ id, name: "run_command", args: { executable: "node", args: ["--test"] } });
const COMMAND_OK = { ok: true as const, payload: { exitCode: 0, stdout: "", stderr: "", timedOut: false, truncated: false } };

function withIntegrity(h: Harness, integrity: IntegrityChecker): EngineDeps {
  return { ...h.deps, integrity };
}

function phases(h: Harness): IntegrityPhase[] {
  return h.journal.ofType("integrity_checked").map((event) => event.phase);
}

function eventTypes(h: Harness): string[] {
  return h.journal.events.map((event) => event.type);
}

const REPAIRS: TaskOverrides = { limits: { maxRepairAttempts: 3, maxSameFailures: 3 } };

describe("K3 without an integrity checker nothing changes", () => {
  test("no integrity_checked record and no protectedChanged field", async () => {
    const h = harness({ steps: [() => finalAnswer()] });
    const result = await runTask(h.deps);
    assert.equal(result.status, "done");
    assert.equal(h.journal.ofType("integrity_checked").length, 0);
    assert.equal(Object.hasOwn(result, "protectedChanged"), false);
  });
});

describe("K3 nothing protected changed: the run behaves as before", () => {
  test("three checks are recorded, each empty, and the result is the same as without a checker", async () => {
    const plain = harness({ steps: [() => finalAnswer()] });
    const expected = await runTask(plain.deps);

    const h = harness({ steps: [() => finalAnswer()] });
    const integrity = new FakeIntegrity();
    const result = await runTask(withIntegrity(h, integrity));

    assert.equal(result.status, expected.status);
    assert.equal(result.reason, expected.reason);
    assert.deepEqual(result.verifiers, expected.verifiers);
    assert.deepEqual(result.notices, expected.notices);
    assert.deepEqual(result.protectedChanged, []);
    assert.deepEqual(phases(h), ["run_start", "before_verify", "after_verify"]);
    for (const event of h.journal.ofType("integrity_checked")) assert.deepEqual(event.changed, []);
    assert.equal(integrity.captures, 3);
  });

  test("run_start is checked after run_started and before the first model request", async () => {
    const h = harness({ steps: [() => finalAnswer()] });
    await runTask(withIntegrity(h, new FakeIntegrity()));
    const types = eventTypes(h);
    assert.equal(types[0], "run_started");
    assert.equal(types[1], "integrity_checked");
    assert.equal(types[2], "model_request");
    // before_verify sits right before the round's verifier_result, after_verify right after it.
    const verified = types.indexOf("verifier_result");
    assert.equal(types[verified - 1], "integrity_checked");
    assert.equal(types[verified + 1], "integrity_checked");
  });

  test("a failed round still repairs when nothing protected changed; every round is checked", async () => {
    const h = harness({
      steps: [() => finalAnswer(), () => finalAnswer()],
      task: REPAIRS,
      verifiers: new FakeVerifiers({ v1: ["fail", "pass"] }, { v1: ["one failing", "ok"] }),
    });
    const result = await runTask(withIntegrity(h, new FakeIntegrity()));
    assert.equal(result.status, "done");
    assert.equal(result.usage.repairAttempts, 1);
    assert.deepEqual(phases(h), ["run_start", "before_verify", "after_verify", "before_verify", "after_verify"]);
    assert.deepEqual(result.protectedChanged, []);
  });
});

describe("K3 a change before verification (a model command changed a protected file)", () => {
  test("the verifiers are not run and the run ends needs-input/protected_changed without a repair", async () => {
    const integrity = new FakeIntegrity();
    const tools = new FakeTools((call) => {
      if (call.name === "run_command") integrity.change(TEST_FILE);
      return COMMAND_OK;
    });
    const verifiers = new FakeVerifiers({ v1: "pass" });
    const h = harness({ steps: [() => response([runCommand("c1")]), () => finalAnswer()], tools, verifiers, task: REPAIRS });
    const result = await runTask(withIntegrity(h, integrity));

    assert.equal(result.status, "needs-input");
    assert.equal(result.reason, "protected_changed");
    assert.equal(result.exitCode, RUN_EXIT_CODES["needs-input"]);
    assert.deepEqual(verifiers.runs, []);
    assert.deepEqual(result.verifiers, []);
    assert.equal(h.journal.ofType("verifier_result").length, 0);
    assert.equal(h.journal.ofType("repair_started").length, 0);
    assert.equal(h.model.requests.length, 2);
    assert.deepEqual(phases(h), ["run_start", "before_verify"]);
    assert.deepEqual(h.journal.ofType("integrity_checked")[1]?.changed, [TEST_FILE]);
    assert.deepEqual(result.protectedChanged, [TEST_FILE]);
    assert.ok(result.notices.some((notice) => notice.includes(TEST_FILE) && notice.includes("before verification")));
    assert.equal(h.journal.ofType("run_finished")[0]?.reason, "protected_changed");
  });

  test("material outside the workspace (integrity.paths) is treated the same way", async () => {
    const integrity = new FakeIntegrity({
      [EXTERNAL_FILE]: { kind: "file", sha256: SHA_1 },
      [TEST_FILE]: { kind: "file", sha256: SHA_1 },
    });
    const tools = new FakeTools(() => {
      integrity.world.set(EXTERNAL_FILE, { kind: "absent" });
      return COMMAND_OK;
    });
    const h = harness({ steps: [() => response([runCommand("c1")]), () => finalAnswer()], tools });
    const result = await runTask(withIntegrity(h, integrity));
    assert.equal(result.reason, "protected_changed");
    assert.deepEqual(result.protectedChanged, [EXTERNAL_FILE]);
  });
});

describe("K3 a change during verification (a verifier command changed a protected file)", () => {
  test("a passing round is not trusted: needs-input/protected_changed, not done", async () => {
    const integrity = new FakeIntegrity();
    const verifiers = new HookVerifiers(
      () => "pass",
      () => integrity.change(TEST_FILE),
    );
    const h = harness({ steps: [() => finalAnswer()] });
    const result = await runTask({ ...withIntegrity(h, integrity), verifiers });

    assert.equal(result.status, "needs-input");
    assert.equal(result.reason, "protected_changed");
    assert.deepEqual(phases(h), ["run_start", "before_verify", "after_verify"]);
    assert.deepEqual(h.journal.ofType("integrity_checked")[2]?.changed, [TEST_FILE]);
    assert.deepEqual(result.protectedChanged, [TEST_FILE]);
    // The round's results are kept for the reader; the status says they are not trusted.
    assert.equal(result.verifiers[0]?.outcome, "pass");
    assert.ok(result.notices.some((notice) => notice.includes("after verification")));
  });

  test("a failing round is not repaired even with repairs left", async () => {
    const integrity = new FakeIntegrity();
    const verifiers = new HookVerifiers(
      () => "fail",
      () => integrity.change(TEST_FILE),
    );
    const h = harness({ steps: [() => finalAnswer(), () => finalAnswer()], task: REPAIRS });
    const result = await runTask({ ...withIntegrity(h, integrity), verifiers });

    assert.equal(result.reason, "protected_changed");
    assert.equal(result.usage.repairAttempts, 0);
    assert.equal(h.journal.ofType("repair_started").length, 0);
    assert.equal(h.model.requests.length, 1);
  });

  test("the comparison is always against the run_start baseline, not the previous check", async () => {
    // Round 1 changes the file and fails; had after_verify compared with before_verify only,
    // round 2 would look clean. It does not get that far.
    const integrity = new FakeIntegrity();
    const verifiers = new HookVerifiers(
      () => "fail",
      (_config, round) => {
        if (round === 0) integrity.change(TEST_FILE);
      },
    );
    const h = harness({ steps: [() => finalAnswer(), () => finalAnswer()], task: REPAIRS });
    const result = await runTask({ ...withIntegrity(h, integrity), verifiers });
    assert.equal(result.reason, "protected_changed");
    assert.deepEqual(verifiers.runs, ["v1"]);
  });
});

describe("K3 a change between repair rounds", () => {
  test("a command in the repair turn changes a protected file: the next round is not run", async () => {
    const integrity = new FakeIntegrity();
    const tools = new FakeTools((call) => {
      if (call.name === "run_command") integrity.change(TEST_FILE);
      return COMMAND_OK;
    });
    const verifiers = new FakeVerifiers({ v1: ["fail", "pass"] }, { v1: ["one failing", "ok"] });
    const h = harness({
      steps: [() => finalAnswer(), () => response([runCommand("c2")]), () => finalAnswer()],
      tools,
      verifiers,
      task: REPAIRS,
    });
    const result = await runTask(withIntegrity(h, integrity));

    assert.equal(result.status, "needs-input");
    assert.equal(result.reason, "protected_changed");
    assert.equal(result.usage.repairAttempts, 1);
    assert.deepEqual(verifiers.runs, ["v1"]);
    assert.deepEqual(phases(h), ["run_start", "before_verify", "after_verify", "before_verify"]);
    assert.deepEqual(h.journal.ofType("integrity_checked").map((event) => event.changed.length), [0, 0, 0, 1]);
    // EngineResult.verifiers keeps the last round that ran (round 1, the failure).
    assert.equal(result.verifiers[0]?.outcome, "fail");
    assert.equal(h.model.requests.length, 3);
  });
});

describe("K3 only masked paths are recorded and printed", () => {
  const SECRET_PATH = `tests/${FAKE_SECRET}.json`;

  test("a changed path that holds a secret appears only as a token", async () => {
    const integrity = new FakeIntegrity({ [SECRET_PATH]: { kind: "file", sha256: SHA_1 } });
    const verifiers = new HookVerifiers(
      () => "pass",
      () => integrity.change(SECRET_PATH),
    );
    const h = harness({ steps: [() => finalAnswer()] });
    const result = await runTask({ ...withIntegrity(h, integrity), verifiers });

    const masked = `tests/${FAKE_TOKEN}.json`;
    assert.deepEqual(result.protectedChanged, [masked]);
    assert.deepEqual(h.journal.ofType("integrity_checked")[2]?.changed, [masked]);
    assert.ok(result.notices.some((notice) => notice.includes(masked)));
    assert.equal(JSON.stringify(h.journal.events).includes(FAKE_SECRET), false);
    assert.equal(JSON.stringify(result).includes(FAKE_SECRET), false);
  });

  test("when a changed path cannot be masked nothing about it is recorded and the run ends", async () => {
    const integrity = new FakeIntegrity({ [SECRET_PATH]: { kind: "file", sha256: SHA_1 } });
    const verifiers = new HookVerifiers(
      () => "pass",
      () => integrity.change(SECRET_PATH),
    );
    const h = harness({
      steps: [() => finalAnswer()],
      privacy: fakePrivacy({ failWhen: (text) => text.includes(FAKE_SECRET) }),
    });
    const result = await runTask({ ...withIntegrity(h, integrity), verifiers });

    assert.equal(result.status, "failed");
    assert.equal(result.reason, "model_error");
    assert.deepEqual(phases(h), ["run_start", "before_verify"]);
    assert.equal(JSON.stringify(h.journal.events).includes(FAKE_SECRET), false);
    assert.equal(JSON.stringify(result).includes(FAKE_SECRET), false);
    assert.deepEqual(result.protectedChanged, []);
  });

  test("the notice names at most INTEGRITY_NOTICE_PATHS paths; the record and result keep them all", async () => {
    const total = INTEGRITY_NOTICE_PATHS + 2;
    const names = Array.from({ length: total }, (_, index) => `tests/f${String(index).padStart(2, "0")}.mjs`);
    const integrity = new FakeIntegrity(Object.fromEntries(names.map((name) => [name, { kind: "file", sha256: SHA_1 }])));
    const verifiers = new HookVerifiers(
      () => "pass",
      () => {
        for (const name of names) integrity.change(name);
      },
    );
    const h = harness({ steps: [() => finalAnswer()] });
    const result = await runTask({ ...withIntegrity(h, integrity), verifiers });

    assert.equal(result.protectedChanged?.length, total);
    const notice = result.notices.find((text) => text.includes("after verification")) ?? "";
    assert.ok(notice.includes(names[INTEGRITY_NOTICE_PATHS - 1] ?? "?"));
    assert.equal(notice.includes(names[INTEGRITY_NOTICE_PATHS] ?? "?"), false);
    assert.ok(notice.endsWith(", and 2 more"));
  });

  test("the new fixed notice texts are part of FIXED_MODEL_TEXTS", () => {
    for (const lead of ["before verification", "after verification", "at run start", "could not be completed"]) {
      assert.ok(FIXED_MODEL_TEXTS.some((text) => text.includes(lead)), lead);
    }
  });
});

describe("K3 material that cannot be checked fails closed (contract: unchecked, capture failure)", () => {
  test("an unchecked entry at run start (over the limits) ends the run before the first model request", async () => {
    const integrity = new FakeIntegrity({ tests: { kind: "unchecked", why: "limit" } });
    const h = harness({ steps: [() => finalAnswer()] });
    const result = await runTask(withIntegrity(h, integrity));

    assert.equal(result.status, "needs-input");
    assert.equal(result.reason, "protected_changed");
    assert.equal(h.model.requests.length, 0);
    assert.deepEqual(phases(h), ["run_start"]);
    assert.deepEqual(result.protectedChanged, ["tests"]);
    assert.ok(result.notices.some((notice) => notice.includes("at run start")));
  });

  test("a protected file that becomes unreadable before verification is treated as changed", async () => {
    const integrity = new FakeIntegrity();
    const tools = new FakeTools(() => {
      integrity.world.set(TEST_FILE, { kind: "unchecked", why: "unreadable" });
      return COMMAND_OK;
    });
    const h = harness({ steps: [() => response([runCommand("c1")]), () => finalAnswer()], tools });
    const result = await runTask(withIntegrity(h, integrity));
    assert.equal(result.reason, "protected_changed");
    assert.deepEqual(result.protectedChanged, [TEST_FILE]);
  });

  test("a capture that rejects at run start ends the run without a record or a model request", async () => {
    const integrity = new FakeIntegrity();
    integrity.failOn = 1;
    const h = harness({ steps: [() => finalAnswer()] });
    const result = await runTask(withIntegrity(h, integrity));

    assert.equal(result.status, "needs-input");
    assert.equal(result.reason, "protected_changed");
    assert.equal(h.model.requests.length, 0);
    assert.deepEqual(phases(h), []);
    // No check was recorded, so the field is absent (contract: present only after a record).
    assert.equal(Object.hasOwn(result, "protectedChanged"), false);
    assert.ok(result.notices.some((notice) => notice.includes("could not be completed")));
    assert.equal(h.journal.ofType("run_finished")[0]?.reason, "protected_changed");
  });

  test("a capture that rejects after verification makes a passing round untrusted", async () => {
    const integrity = new FakeIntegrity();
    integrity.failOn = 3;
    const h = harness({ steps: [() => finalAnswer()] });
    const result = await runTask(withIntegrity(h, integrity));

    assert.equal(result.reason, "protected_changed");
    assert.equal(result.verifiers[0]?.outcome, "pass");
    assert.deepEqual(phases(h), ["run_start", "before_verify"]);
    assert.deepEqual(result.protectedChanged, []);
  });
});

describe("K3 order with cancel and limits", () => {
  test("a cancel already in effect when the round starts: cancelled, before_verify is not made", async () => {
    const integrity = new FakeIntegrity();
    const box: { controller?: AbortController } = {};
    const h = harness({
      steps: [
        () => {
          box.controller?.abort();
          integrity.change(TEST_FILE);
          return finalAnswer();
        },
      ],
    });
    box.controller = h.controller;
    const result = await runTask(withIntegrity(h, integrity));

    assert.equal(result.status, "cancelled");
    assert.deepEqual(phases(h), ["run_start"]);
    assert.deepEqual(result.protectedChanged, []);
    assert.equal(integrity.captures, 1);
  });

  test("cancel during verification wins over a change made in that round: no after_verify capture", async () => {
    const integrity = new FakeIntegrity();
    const box: { controller?: AbortController } = {};
    const verifiers = new HookVerifiers(
      () => "pass",
      () => {
        integrity.change(TEST_FILE);
        box.controller?.abort();
      },
    );
    const h = harness({ steps: [() => finalAnswer()] });
    box.controller = h.controller;
    const result = await runTask({ ...withIntegrity(h, integrity), verifiers });

    assert.equal(result.status, "cancelled");
    assert.deepEqual(phases(h), ["run_start", "before_verify"]);
    assert.deepEqual(result.protectedChanged, []);
    assert.equal(integrity.captures, 2);
  });

  test("the duration limit reached during verification stays budget-exhausted (T-8); no after_verify capture", async () => {
    const integrity = new FakeIntegrity();
    const clock = new FakeClock();
    const verifiers = new HookVerifiers(
      () => "pass",
      () => {
        integrity.change(TEST_FILE);
        clock.t = 600_000;
      },
    );
    const h = harness({ steps: [() => finalAnswer()], clock });
    const result = await runTask({ ...withIntegrity(h, integrity), verifiers });

    assert.equal(result.status, "budget-exhausted");
    assert.equal(result.reason, "max_duration");
    assert.deepEqual(phases(h), ["run_start", "before_verify"]);
  });

  test("a check that is made wins over the duration limit reached during its own capture", async () => {
    const integrity = new FakeIntegrity();
    const clock = new FakeClock();
    integrity.onCapture = (index) => {
      if (index === 3) {
        clock.t = 600_000;
        integrity.change(TEST_FILE);
      }
    };
    const h = harness({ steps: [() => finalAnswer()], clock });
    const result = await runTask(withIntegrity(h, integrity));

    assert.equal(result.status, "needs-input");
    assert.equal(result.reason, "protected_changed");
    assert.deepEqual(phases(h), ["run_start", "before_verify", "after_verify"]);
  });

  test("the duration limit reached during an empty after_verify capture is not reported as done", async () => {
    const integrity = new FakeIntegrity();
    const clock = new FakeClock();
    integrity.onCapture = (index) => {
      if (index === 3) clock.t = 600_000;
    };
    const h = harness({ steps: [() => finalAnswer()], clock });
    const result = await runTask(withIntegrity(h, integrity));

    assert.equal(result.status, "budget-exhausted");
    assert.equal(result.reason, "max_duration");
    assert.deepEqual(phases(h), ["run_start", "before_verify", "after_verify"]);
    assert.deepEqual(result.protectedChanged, []);
  });

  test("a task without verifiers has no verification round, so only run_start is checked", async () => {
    const integrity = new FakeIntegrity();
    const tools = new FakeTools(() => {
      integrity.change(TEST_FILE);
      return COMMAND_OK;
    });
    const h = harness({ steps: [() => response([runCommand("c1")]), () => finalAnswer()], tools, task: { verifiers: [] } });
    const result = await runTask(withIntegrity(h, integrity));
    assert.equal(result.reason, "no_verifier");
    assert.deepEqual(phases(h), ["run_start"]);
  });
});
