/**
 * DR-25: the person's consent to move files back unsafely (no hard links on the volume) in one
 * revert, as DR-21 for apply: the CLI's own argument (`--allow-unsafe-move`, cli-flag), a terminal
 * answer after the revert skipped such files (cli-tty), or the app layer's adapter path. No file
 * gives it. The revert command, lock and record writing are the CLI's own; `revertRun` is a
 * stand-in that skips one file as `unsafe_move` unless the consent names the run, since this
 * volume has hard links.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { UNSAFE_MOVE_CONSENT_ARGUMENT } from "../../../src/contracts/index.js";
import type { RevertOutcome, RevertOutput, RevertRecord, RevertRequest, RunId } from "../../../src/contracts/index.js";
import { parseRevertArgs } from "../../../src/cli/args.js";
import { createRevertCommand } from "../../../src/cli/assemble.js";
import { runRevert } from "../../../src/cli/revert.js";
import type { RevertEnvironment } from "../../../src/cli/revert.js";

const temporaryDirs: string[] = [];
after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true });
});
const RUN = "20261112T050000Z-0000abcd";
let seed = 91;
const randomBytes = (size: number): Uint8Array => new Uint8Array(size).fill(seed++ % 250);

async function workspace(): Promise<string> {
  const ws = await mkdtemp(path.join(tmpdir(), "codaryn-g-revert-consent-"));
  temporaryDirs.push(ws);
  await mkdir(path.join(ws, ".codaryn", "runs", RUN), { recursive: true });
  await writeFile(path.join(ws, ".codaryn", "runs", RUN, "journal.jsonl"), "", "utf8");
  return ws;
}

/** One safe move back and one that needs the consent for this run. */
function standIn(): { calls: RevertRequest[]; records: RevertRecord[]; revertRun: (request: RevertRequest) => Promise<RevertOutcome> } {
  const calls: RevertRequest[] = [];
  const records: RevertRecord[] = [];
  const revertRun = async (request: RevertRequest): Promise<RevertOutcome> => {
    calls.push(request);
    if (request.dryRun === true) {
      return { reverted: [{ path: "a.txt", action: "moved_back", from: "sorted/a.txt" }], skipped: [], moveSafetyUnchecked: true };
    }
    const consented = request.unsafeMoveConsent?.runId === request.runId;
    return consented
      ? { reverted: [{ path: "a.txt", action: "moved_back", from: "sorted/a.txt" }, { path: "b.txt", action: "moved_back", from: "sorted/b.txt", unsafe: true }], skipped: [] }
      : { reverted: [{ path: "a.txt", action: "moved_back", from: "sorted/a.txt" }], skipped: [{ path: "b.txt", reason: "unsafe_move" }] };
  };
  return { calls, records, revertRun };
}

function env(ws: string, extra: readonly string[], engine: ReturnType<typeof standIn>, more: Partial<RevertEnvironment> = {}): RevertEnvironment {
  return {
    argv: ["revert", "--workspace", ws, "--run", RUN, ...extra],
    cwd: ws,
    isDirectory: async () => true,
    clock: { now: () => Date.now() },
    randomBytes,
    revert: createRevertCommand(engine.revertRun, {
      dryRun: engine.revertRun,
      writeRecord: async (_root, record) => {
        engine.records.push(record);
      },
    }),
    ...more,
  };
}

describe("DR-25: the revert's consent argument", () => {
  test("revert takes --allow-unsafe-move; a dry run refuses it, since it moves nothing", () => {
    const base = ["revert", "--workspace", "w", "--run", RUN];
    const off = parseRevertArgs(base);
    const on = parseRevertArgs([...base, UNSAFE_MOVE_CONSENT_ARGUMENT]);
    assert.ok(off.ok && on.ok);
    assert.deepEqual([off.args.allowUnsafeMove, on.args.allowUnsafeMove], [false, true]);
    assert.equal(parseRevertArgs([...base, "--dry-run", UNSAFE_MOVE_CONSENT_ARGUMENT]).ok, false);
  });

  test("with it the store gets a cli-flag consent naming the run, and the record keeps the channel and the unsafe count", async () => {
    const ws = await workspace();
    const engine = standIn();
    const outcome = await runRevert(env(ws, [UNSAFE_MOVE_CONSENT_ARGUMENT], engine));
    assert.ok(outcome.output.kind === "revert" && outcome.output.status === "complete", JSON.stringify(outcome.output));
    assert.deepEqual(engine.calls[0]?.unsafeMoveConsent, { channel: "cli-flag", runId: RUN });
    assert.deepEqual([engine.records[0]?.unsafeMoveConsent, engine.records[0]?.unsafeMoves], ["cli-flag", 1]);
  });

  test("without it the file is skipped as unsafe_move and the record says no consent", async () => {
    const ws = await workspace();
    const engine = standIn();
    const outcome = await runRevert(env(ws, [], engine));
    assert.ok(outcome.output.kind === "revert" && outcome.output.status === "partial");
    assert.equal(engine.calls[0]?.unsafeMoveConsent ?? null, null);
    assert.deepEqual([engine.records[0]?.unsafeMoveConsent, engine.records[0]?.unsafeMoves], [null, 0]);
  });

  test("a dry run passes moveSafetyUnchecked on and uses no consent", async () => {
    const ws = await workspace();
    const engine = standIn();
    const outcome = await runRevert(env(ws, ["--dry-run"], engine));
    assert.ok(outcome.output.kind === "revert");
    assert.equal((outcome.output as RevertOutput).moveSafetyUnchecked, true);
    assert.equal(engine.calls[0]?.unsafeMoveConsent ?? null, null);
    assert.equal(engine.records.length, 0);
  });
});

describe("DR-25: the terminal answer", () => {
  test("after unsafe_move skips the person is asked once; yes reverts again with cli-tty, the default is no", async () => {
    for (const [answer, calls, status] of [["y", 2, "complete"], ["", 1, "partial"]] as const) {
      const ws = await workspace();
      const engine = standIn();
      const questions: string[] = [];
      const outcome = await runRevert(
        env(ws, [], engine, {
          ask: async (question) => {
            questions.push(question);
            return answer;
          },
        }),
      );
      assert.ok(outcome.output.kind === "revert", JSON.stringify(outcome.output));
      assert.equal(outcome.output.status, status, answer);
      assert.equal(engine.calls.length, calls);
      assert.equal(questions.length, 1);
      assert.ok(questions[0]?.includes("1 file") && questions[0].includes("[y/N]"), String(questions[0]));
      if (calls === 2) assert.deepEqual(engine.calls[1]?.unsafeMoveConsent, { channel: "cli-tty", runId: RUN });
    }
  });

  test("nobody is asked when nothing was skipped as unsafe_move or the argument was given", async () => {
    const ws = await workspace();
    const engine = standIn();
    let asked = 0;
    await runRevert(env(ws, [UNSAFE_MOVE_CONSENT_ARGUMENT], engine, { ask: async () => String(++asked) }));
    assert.equal(asked, 0);
  });
});

describe("DR-25: the app layer's adapter path", () => {
  test("the person's on-screen consent for this run reaches the store as adapter; nobody is asked", async () => {
    const ws = await workspace();
    const engine = standIn();
    let asked = 0;
    const outcome = await runRevert(
      env(ws, [], engine, { adapter: { unsafeMoveConsent: { channel: "adapter", runId: RUN as RunId } }, ask: async () => String(++asked) }),
    );
    assert.ok(outcome.output.kind === "revert" && outcome.output.status === "complete");
    assert.deepEqual(engine.calls[0]?.unsafeMoveConsent, { channel: "adapter", runId: RUN });
    assert.equal(engine.records[0]?.unsafeMoveConsent, "adapter");
    assert.equal(asked, 0);
    const none = standIn();
    await runRevert(env(ws, [], none, { adapter: { unsafeMoveConsent: null }, ask: async () => String(++asked) }));
    assert.equal(asked, 0, "consent null: no question, the GUI asks the person");
  });

  test("a consent for another run, of another channel, or with the argument is refused before anything changes", async () => {
    const ws = await workspace();
    const cases: { extra: string[]; consent: unknown }[] = [
      { extra: [], consent: { channel: "adapter", runId: "20261112T050001Z-0000abce" } },
      { extra: [], consent: { channel: "cli-flag", runId: RUN } },
      { extra: [UNSAFE_MOVE_CONSENT_ARGUMENT], consent: null },
    ];
    for (const item of cases) {
      const engine = standIn();
      const outcome = await runRevert(env(ws, item.extra, engine, { adapter: { unsafeMoveConsent: item.consent as never } }));
      assert.ok(outcome.output.kind === "error" && outcome.output.code === "invalid_arguments", JSON.stringify(outcome.output));
      assert.equal(engine.calls.length, 0);
    }
  });
});
