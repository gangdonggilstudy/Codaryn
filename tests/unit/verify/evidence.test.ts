/**
 * T-6: a verifier never cuts raw evidence. Command output goes into the evidence exactly as the
 * command runner returned it, and `evidenceTruncated` says when the runner dropped output.
 * The engine masks first and cuts afterwards. Fake values only.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { MAX_COMMAND_OUTPUT_BYTES } from "../../../src/contracts/index.js";
import type { ResolvedPath, RunCommandPayload, VerifierConfig, Workspace } from "../../../src/contracts/index.js";
import { createRawVerifierResult, createVerifierRunner } from "../../../src/verify/index.js";

/** Contract stand-in (P-5): every path resolves to the root; nothing else is used. */
function workspaceAt(root: string): Workspace {
  return {
    root,
    async resolve() {
      return { ok: true, path: { absolute: root, relative: "." } as unknown as ResolvedPath };
    },
    async readText() {
      return { ok: false, code: "io_error" };
    },
    async list() {
      return { ok: false, code: "io_error" };
    },
    async writeText() {
      return { ok: false, code: "io_error" };
    },
  };
}

const COMMAND: VerifierConfig = { id: "tests", kind: "command", executable: "node", args: ["--test"] };

async function verify(reply: RunCommandPayload) {
  const root = await mkdtemp(join(tmpdir(), "codaryn-evidence-"));
  try {
    const runner = createVerifierRunner({ workspace: workspaceAt(root), commandRunner: { run: async () => reply } });
    return await runner.run(COMMAND, new AbortController().signal);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const payload = (extra: Partial<RunCommandPayload>): RunCommandPayload => ({
  exitCode: 1,
  stdout: "",
  stderr: "",
  timedOut: false,
  truncated: false,
  ...extra,
});

test("T-6: a registered secret at the old 2000-character cut stays whole in the evidence", async () => {
  // Review input (repair-engine 2, E2): a 27-character secret followed by 1974 characters, so a
  // 2000-character tail would start at the secret's second character.
  const secret = "fake-SECRET-value-cut-0001x";
  assert.equal(secret.length, 27);
  const stdout = secret + "x".repeat(2000 - 26);
  const result = await verify(payload({ stdout }));
  assert.equal(result.outcome, "fail");
  assert.ok(result.evidence.includes(secret), "the secret must stay whole so that masking can find it");
  assert.ok(result.evidence.includes(stdout));
  assert.equal(result.evidenceTruncated, undefined);
});

test("T-6: output that the runner did not cut is passed on whole", async () => {
  const stdout = `${"o".repeat(50_000)}\nlast stdout line`;
  const stderr = `${"e".repeat(30_000)}\nlast stderr line`;
  const result = await verify(payload({ stdout, stderr }));
  assert.ok(result.evidence.includes(stdout));
  assert.ok(result.evidence.includes(stderr));
  assert.ok(!result.evidence.includes("..."), "no tail marker");
  assert.equal(result.evidenceTruncated, undefined);
});

test("T-6: output the runner cut is marked, and the stream it may have cut ends the evidence", async () => {
  const big = "o".repeat(MAX_COMMAND_OUTPUT_BYTES + 100);
  const small = "short output";

  const stdoutCut = await verify(payload({ stdout: big, stderr: small, truncated: true }));
  assert.equal(stdoutCut.evidenceTruncated, true);
  assert.ok(stdoutCut.evidence.includes(small));
  assert.ok(stdoutCut.evidence.endsWith(big), "the possibly cut stdout must be last");

  const stderrCut = await verify(payload({ stdout: small, stderr: big, truncated: true }));
  assert.equal(stderrCut.evidenceTruncated, true);
  assert.ok(stderrCut.evidence.includes(small));
  assert.ok(stderrCut.evidence.endsWith(big), "the possibly cut stderr must be last");

  // Both streams at the cap: both are kept whole. The first one's end is farther than
  // MAX_COMMAND_OUTPUT_BYTES from either end of the evidence.
  const big2 = "e".repeat(MAX_COMMAND_OUTPUT_BYTES + 50);
  const both = await verify(payload({ stdout: big, stderr: big2, truncated: true }));
  assert.equal(both.evidenceTruncated, true);
  assert.ok(both.evidence.includes(big) && both.evidence.endsWith(big2));
});

test("T-6: timed out and abnormal exits carry the whole output and the mark too", async () => {
  const stdout = "z".repeat(MAX_COMMAND_OUTPUT_BYTES + 10);
  const timedOut = await verify(payload({ exitCode: null, stdout, timedOut: true, truncated: true }));
  assert.equal(timedOut.outcome, "inconclusive");
  assert.equal(timedOut.evidenceTruncated, true);
  assert.ok(timedOut.evidence.endsWith(stdout));

  const crashed = await verify(payload({ exitCode: null, stderr: "y".repeat(5000) }));
  assert.equal(crashed.outcome, "inconclusive");
  assert.ok(crashed.evidence.includes("y".repeat(5000)));
  assert.equal(crashed.evidenceTruncated, undefined);
});

test("T-6: createRawVerifierResult keeps evidenceTruncated only when true and checks its type", () => {
  const base = { id: "v", kind: "command" as const, outcome: "fail" as const, evidence: "e", checked: ["c"], limits: [] };
  assert.equal(createRawVerifierResult({ ...base, evidenceTruncated: true }).evidenceTruncated, true);
  assert.equal("evidenceTruncated" in createRawVerifierResult({ ...base, evidenceTruncated: false }), false);
  assert.equal("evidenceTruncated" in createRawVerifierResult(base), false);
  assert.throws(() => createRawVerifierResult({ ...base, evidenceTruncated: "yes" as unknown as boolean }), TypeError);
});
