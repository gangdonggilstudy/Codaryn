/**
 * U-50, review R-68: the eighteen failures the reviewer raised with the real tools, fixed as a test,
 * each hint checked against what really happened. The engine with the real workspace, policy gate,
 * privacy gateway and tool runner; only the model is scripted. Fake values only, no network.
 * - M-1 (PM): spawn_failed gets no hint. It is not only a missing program: on Windows a .cmd inside
 *   the workspace, an argument cmd.exe cannot take, or a file type that cannot be started; the tool's
 *   message names the reason.
 * - L-1: not_text also comes from a directory (read_file, write_file); its hint says so.
 * - L-2: not_found also comes from search_files given a file; its hint says so.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { TOOL_FAILURE_HINTS } from "../../../src/contracts/index.js";
import type { CommandRule, JsonObject, ModelOutcome, ToolCall, ToolErrorCode, ToolResult } from "../../../src/contracts/index.js";
import { runTask } from "../../../src/engine/index.js";
import { createPolicyGate } from "../../../src/policy/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { createToolRunner } from "../../../src/tools/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { finalAnswer, harness, response } from "./fakes.js";

const SECRET = "fake-u50-value-7Q2Z";
const WINDOWS = process.platform === "win32";
const HINTS = Object.values(TOOL_FAILURE_HINTS) as string[];

let base = "";
let root = "";

before(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-u50-")));
  root = path.join(base, "ws");
  await fs.mkdir(path.join(root, "dir1"), { recursive: true });
  await fs.writeFile(path.join(root, "a.txt"), "alpha\n");
  await fs.writeFile(path.join(root, "dir1", "inner.txt"), "inner\n");
  await fs.writeFile(path.join(root, "big.txt"), "x".repeat(300_000));
  await fs.writeFile(path.join(root, "bin.dat"), Buffer.from([0x61, 0x00, 0x62]));
  await fs.writeFile(path.join(root, "utf16.txt"), Buffer.from([0xff, 0xfe, 0x61, 0x00]));
  await fs.writeFile(path.join(root, "s.txt"), `key=${SECRET}\nother\n`);
  await fs.writeFile(path.join(root, "inside.cmd"), "@echo inside\r\n");
  await fs.writeFile(path.join(base, "outside.cmd"), "@echo outside\r\n");
  await fs.writeFile(path.join(base, "outside.ps1"), "Write-Output 1\r\n");
});
after(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

const call = (id: string, name: string, args: JsonObject): ToolCall => ({ id, name, args });
const write = (id: string, file: string, change: JsonObject, expectedHash: string | null = null): ToolCall =>
  call(id, "write_file", { path: file, expectedHash, change });

/** One scripted run of `calls`, each its own turn; the failed results by call id. */
async function failures(calls: readonly ToolCall[], options: { commands?: CommandRule[]; secrets?: string[] } = {}): Promise<Map<string, ToolResult>> {
  const workspace = await createWorkspace({ root });
  const privacy = createPrivacyGateway({ secrets: options.secrets ?? [SECRET] });
  const policy = { commands: options.commands ?? [], network: "deny", destructive: "deny", restorePathTokens: false } as const;
  const steps: ((request: unknown) => ModelOutcome)[] = [...calls.map((one) => () => response([one])), () => finalAnswer()];
  const h = harness({
    steps,
    task: { workspaceRoot: root, policy, limits: { maxModelTurns: 30, maxToolCalls: 30, maxSameFailures: 30 }, verifiers: [] },
  });
  h.deps = { ...h.deps, privacy, policy: createPolicyGate({ config: policy, workspace }), tools: createToolRunner({ workspace, privacy }) };
  await runTask(h.deps);
  const results = new Map<string, ToolResult>();
  for (const event of h.journal.ofType("tool_result")) if (!event.result.ok) results.set(event.result.callId, event.result);
  return results;
}

/** The result failed with `code`, and ends with that code's hint exactly once (or has none). */
function told(results: Map<string, ToolResult>, id: string, code: ToolErrorCode): string {
  const result = results.get(id);
  assert.ok(result !== undefined, `${id} failed`);
  assert.equal(result.errorCode, code, `${id}: ${result.content}`);
  assert.ok(result.content.startsWith(`error (${code}): `), result.content);
  const hint = TOOL_FAILURE_HINTS[code];
  if (hint === undefined) {
    for (const any of HINTS) assert.equal(result.content.includes(any), false, `${id} has no hint: ${result.content}`);
  } else {
    assert.ok(result.content.endsWith(` ${hint}`), `${id}: ${result.content}`);
    assert.equal(result.content.split(hint).length - 1, 1, `${id}: the hint once`);
  }
  return result.content;
}

describe("R-68: the hints are true for every failure the reviewer raised (real tools)", () => {
  test("files: r1-r6, w1-w3, s1-s2", async () => {
    const results = await failures([
      call("r1", "read_file", { path: "missing.txt" }),
      call("r2", "read_file", { path: "dir1" }),
      call("r3", "read_file", { path: "big.txt" }),
      call("r4", "read_file", { path: "bin.dat" }),
      call("r5", "read_file", { path: "utf16.txt" }),
      call("r6", "read_file", { path: "a.txt/inner.txt" }),
      write("w1", "dir1", { kind: "replace_all", content: "x\n" }),
      write("w2", "nope.txt", { kind: "replace_text", oldText: "a", newText: "b" }),
      write("w3", "big.txt", { kind: "replace_all", content: "x\n" }),
      call("s1", "search_files", { path: "a.txt", nameContains: "a" }),
      call("s2", "search_files", { path: "no-dir", nameContains: "a" }),
    ]);
    for (const id of ["r1", "r6", "w2", "s1", "s2"]) told(results, id, "not_found");
    for (const id of ["r2", "r4", "r5", "w1"]) told(results, id, "not_text");
    for (const id of ["r3", "w3"]) told(results, id, "too_large");
    // L-1: a directory is one of the things the not_text hint names; L-2: so is a file given where
    // a directory is needed (search_files), next to a missing entry.
    assert.match(TOOL_FAILURE_HINTS.not_text as string, /directory/);
    assert.match(TOOL_FAILURE_HINTS.not_found as string, /missing/);
    assert.match(TOOL_FAILURE_HINTS.not_found as string, /a file where a directory is needed/);
    assert.equal((TOOL_FAILURE_HINTS.not_found as string).startsWith("Nothing is at this path"), false, "s1: the file is there");
  });

  test("commands: c1 everywhere; c2-c4 are Windows refusals with their own reason, and no hint", async () => {
    const commands: CommandRule[] = [
      { executable: path.join(base, "no-such-tool.exe"), argsPrefix: [], allowExtraArgs: false },
      { executable: path.join(root, "inside.cmd"), argsPrefix: [], allowExtraArgs: false },
      { executable: path.join(base, "outside.cmd"), argsPrefix: [], allowExtraArgs: true },
      { executable: path.join(base, "outside.ps1"), argsPrefix: [], allowExtraArgs: false },
    ];
    const results = await failures(
      [
        call("c1", "run_command", { executable: path.join(base, "no-such-tool.exe"), args: [] }),
        ...(WINDOWS
          ? [
              call("c2", "run_command", { executable: path.join(root, "inside.cmd"), args: [] }),
              call("c3", "run_command", { executable: path.join(base, "outside.cmd"), args: ["a b"] }),
              call("c4", "run_command", { executable: path.join(base, "outside.ps1"), args: [] }),
            ]
          : []),
      ],
      { commands },
    );
    told(results, "c1", "spawn_failed");
    assert.equal(Object.hasOwn(TOOL_FAILURE_HINTS, "spawn_failed"), false, "M-1: no hint for spawn_failed");
    if (WINDOWS) {
      assert.match(told(results, "c2", "spawn_failed"), /inside the workspace/);
      assert.match(told(results, "c3", "spawn_failed"), /argument 1/);
      assert.match(told(results, "c4", "spawn_failed"), /only \.exe, \.com, \.cmd and \.bat/);
    }
  });

  test("placeholders: p1 a protected line changed, p2 a placeholder this run never issued", async () => {
    const hash = createHash("sha256").update(`key=${SECRET}\nother\n`).digest("hex");
    const results = await failures([
      call("p0", "read_file", { path: "s.txt" }),
      write("p1", "s.txt", { kind: "replace_text", oldText: "key=", newText: "KEY=" }, hash),
      write("p2", "n.txt", { kind: "replace_all", content: ["x [[CODARYN_", "SECRET:0123456789abcdef]] y\n"].join("") }),
    ]);
    told(results, "p1", "protected_span_violation");
    told(results, "p2", "invalid_token");
  });

  test("h1: a registered value that is a word of a hint is masked like any text, its token whole", async () => {
    // R-68 used "Nothing", the first word of the old hint; "kind" is a word of the new one.
    assert.match(TOOL_FAILURE_HINTS.not_found as string, / kind /);
    const results = await failures([call("h1", "read_file", { path: "missing.txt" })], { secrets: ["kind"] });
    const result = results.get("h1");
    assert.equal(result?.errorCode, "not_found");
    assert.equal(result?.content.includes("kind"), false);
    assert.match(result?.content ?? "", /\[\[CODARYN_SECRET:[0-9a-f]{16}\]\]/);
  });
});
