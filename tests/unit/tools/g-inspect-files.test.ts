/**
 * G-C: `inspect_files` (design general-tasks.md 5.3, contract tool.ts InspectFilesArgs and
 * InspectFilesPayload). Real files in a temporary workspace; privacy is the fake gateway.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { MAX_INSPECT_ENTRIES } from "../../../src/contracts/index.js";
import type { InspectFilesArgs, InspectFilesPayload, RawWorkflowToolOutcome, Workspace } from "../../../src/contracts/index.js";
import { createToolRunner } from "../../../src/tools/index.js";
import type { PlanFileOps } from "../../../src/tools/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { FAKE_SECRET_A, TOKEN_A, createFakePrivacy } from "./doubles.js";

const never = new AbortController().signal;

function sha(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

interface Fixture {
  readonly root: string;
  readonly workspace: Workspace;
  cleanup(): Promise<void>;
}

async function fixture(files: Record<string, string>, dirs: readonly string[] = []): Promise<Fixture> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-gc-inspect-"));
  for (const dir of dirs) await fs.mkdir(path.join(base, dir), { recursive: true });
  for (const [relative, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(base, relative)), { recursive: true });
    await fs.writeFile(path.join(base, relative), text, "utf8");
  }
  const workspace = await createWorkspace({ root: base });
  return { root: workspace.root, workspace, cleanup: () => fs.rm(base, { recursive: true, force: true }) };
}

async function inspect(
  fx: Fixture,
  args: InspectFilesArgs,
  options: { signal?: AbortSignal; fileOps?: Partial<PlanFileOps> } = {},
): Promise<RawWorkflowToolOutcome> {
  const runner = createToolRunner({
    workspace: fx.workspace,
    privacy: createFakePrivacy(),
    ...(options.fileOps === undefined ? {} : { fileOps: options.fileOps }),
  });
  assert.ok(runner.executeWorkflowTool !== undefined);
  return runner.executeWorkflowTool({ id: "c1", name: "inspect_files", args }, options.signal ?? never);
}

function payloadOf(outcome: RawWorkflowToolOutcome): InspectFilesPayload {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  if (!outcome.ok || !("entries" in outcome.payload)) throw new Error("not an inspect payload");
  return outcome.payload;
}

test("G-C inspect_files: lists the tree sorted, with sizes and times, and never the state directory", async () => {
  const fx = await fixture({ "b.txt": "bravo", "a/x.bin": "12345", "a-b.txt": "ab", ".codaryn/runs/r/journal.jsonl": "{}" }, ["empty"]);
  try {
    const payload = payloadOf(await inspect(fx, { path: "." }));
    assert.deepEqual(
      payload.entries.map((e) => [e.path, e.kind, e.size]),
      [
        ["a", "dir", null],
        ["a-b.txt", "file", 2],
        ["a/x.bin", "file", 5],
        ["b.txt", "file", 5],
        ["empty", "dir", null],
      ],
    );
    for (const entry of payload.entries) {
      assert.ok(entry.modifiedAt === null || !Number.isNaN(Date.parse(entry.modifiedAt)));
      assert.equal(entry.sha256, undefined, "no hash unless asked");
    }
    assert.equal(payload.next, null);
    assert.equal(payload.hashesIncomplete, false);
  } finally {
    await fx.cleanup();
  }
});

test("G-C inspect_files: a subdirectory lists root-relative paths", async () => {
  const fx = await fixture({ "docs/a.md": "a", "docs/sub/b.md": "b", "other.txt": "o" });
  try {
    const payload = payloadOf(await inspect(fx, { path: "docs" }));
    assert.deepEqual(payload.entries.map((e) => e.path), ["docs/a.md", "docs/sub", "docs/sub/b.md"]);
  } finally {
    await fx.cleanup();
  }
});

test("G-C inspect_files: hash gives each file's SHA-256", async () => {
  const fx = await fixture({ "a.txt": "same", "b.txt": "same", "c.txt": "other" });
  try {
    const payload = payloadOf(await inspect(fx, { path: ".", hash: true }));
    assert.deepEqual(
      payload.entries.map((e) => [e.path, e.sha256]),
      [
        ["a.txt", sha("same")],
        ["b.txt", sha("same")],
        ["c.txt", sha("other")],
      ],
    );
    assert.equal(payload.hashesIncomplete, false);
  } finally {
    await fx.cleanup();
  }
});

test("G-C inspect_files: files beyond the hash budget get no hash and the payload says so", async () => {
  const fx = await fixture({ "big.bin": "x", "small.txt": "s" });
  try {
    const fileOps: Partial<PlanFileOps> = {
      async lstat(target) {
        const stat = await fs.lstat(target, { bigint: true });
        if (target.endsWith("big.bin")) Object.defineProperty(stat, "size", { value: 65n * 1024n * 1024n });
        return stat;
      },
    };
    const payload = payloadOf(await inspect(fx, { path: ".", hash: true }, { fileOps }));
    const big = payload.entries.find((e) => e.path === "big.bin");
    const small = payload.entries.find((e) => e.path === "small.txt");
    assert.equal(big?.sha256, undefined);
    assert.equal(small?.sha256, sha("s"));
    assert.equal(payload.hashesIncomplete, true);
  } finally {
    await fx.cleanup();
  }
});

test("G-C inspect_files: pages of MAX_INSPECT_ENTRIES continue with after", async () => {
  const files: Record<string, string> = {};
  for (let i = 0; i < MAX_INSPECT_ENTRIES + 7; i += 1) files[`f${String(i).padStart(4, "0")}.txt`] = String(i);
  const fx = await fixture(files);
  try {
    const first = payloadOf(await inspect(fx, { path: "." }));
    assert.equal(first.entries.length, MAX_INSPECT_ENTRIES);
    assert.equal(first.next, `f${String(MAX_INSPECT_ENTRIES - 1).padStart(4, "0")}.txt`);
    assert.ok(first.next !== null);
    const second = payloadOf(await inspect(fx, { path: ".", after: first.next }));
    assert.equal(second.entries.length, 7);
    assert.equal(second.entries[0]?.path, `f${String(MAX_INSPECT_ENTRIES).padStart(4, "0")}.txt`);
    assert.equal(second.next, null);
  } finally {
    await fx.cleanup();
  }
});

test("G-C inspect_files: an after value the model saw masked continues after that path", async () => {
  const fx = await fixture({ "a.txt": "a", "b.txt": "b", [`${FAKE_SECRET_A}.txt`]: "s" });
  try {
    // Raw order: a.txt, b.txt, fake-secret...txt. The model saw the last one as TOKEN_A.txt.
    const payload = payloadOf(await inspect(fx, { path: ".", after: `${TOKEN_A}.txt` }));
    assert.deepEqual(payload.entries, []);
    assert.equal(payload.next, null);
  } finally {
    await fx.cleanup();
  }
});

test("G-C inspect_files: links are neither listed nor followed", async (t) => {
  const fx = await fixture({ "inside/a.txt": "a" });
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "codaryn-gc-outside-"));
  try {
    await fs.writeFile(path.join(outside, "secret.txt"), "outside", "utf8");
    try {
      await fs.symlink(outside, path.join(fx.root, "jump"), "junction");
    } catch {
      t.skip("directory links cannot be created here");
      return;
    }
    const payload = payloadOf(await inspect(fx, { path: "." }));
    assert.deepEqual(payload.entries.map((e) => e.path), ["inside", "inside/a.txt"]);
  } finally {
    await fx.cleanup();
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("G-C inspect_files: bad paths fail without listing anything", async () => {
  const fx = await fixture({ "a.txt": "a" });
  try {
    const cases: [InspectFilesArgs, string][] = [
      [{ path: "../" }, "policy_denied"],
      [{ path: ".codaryn" }, "policy_denied"],
      [{ path: "a.txt" }, "invalid_args"],
      [{ path: "missing-dir" }, "not_found"],
    ];
    for (const [args, code] of cases) {
      const outcome = await inspect(fx, args);
      assert.equal(outcome.ok, false, JSON.stringify(args));
      if (!outcome.ok) assert.equal(outcome.code, code, JSON.stringify(args));
    }
  } finally {
    await fx.cleanup();
  }
});

test("G-C inspect_files: a cancelled call returns cancelled", async () => {
  const fx = await fixture({ "a.txt": "a" });
  try {
    const controller = new AbortController();
    controller.abort();
    const outcome = await inspect(fx, { path: "." }, { signal: controller.signal });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "cancelled");
  } finally {
    await fx.cleanup();
  }
});
