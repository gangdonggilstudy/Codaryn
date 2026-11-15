/**
 * U-203 (Codex V-13): what is under the run's unreadable paths leaves no trace in search_files or
 * inspect_files.
 *
 * - M-1: it is left out before it is counted or entered, so the result, its `truncated` and its
 *   errors are the same whether the unreadable folder is missing, empty or full (MAX_SEARCH_ENTRIES
 *   files, or for inspect_files a listing of MAX_INSPECT_WALK_ENTRIES given at fs.readdir), and a
 *   failure to read it changes nothing: it is never read.
 * - M-2: a name search does not show a link (a junction) whose real path is under an unreadable path,
 *   nor one whose real path cannot be found; a link to a readable folder stays.
 * - V-13b L-1: an empty unreadable list is no list: every result is byte for byte the one without
 *   the option, a dangling link and one that leaves the root included. A value that is not a list
 *   still covers everything.
 *
 * Each case has its control without unreadable paths, which shows the trace the fix removes.
 */

import assert from "node:assert/strict";
import type { Dirent } from "node:fs";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, mock, test } from "node:test";

import { MAX_SEARCH_ENTRIES } from "../../../src/contracts/index.js";
import type { RawToolOutcome, RawWorkflowToolOutcome, Workspace } from "../../../src/contracts/index.js";
import { createToolRunner } from "../../../src/tools/index.js";
import { MAX_INSPECT_WALK_ENTRIES } from "../../../src/tools/workflow-tools.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { createFakePrivacy } from "./doubles.js";

const never = new AbortController().signal;
const HIDDEN = ["a-hidden"];
let base: string;
/** No a-hidden folder, an empty one, and one holding MAX_SEARCH_ENTRIES files. */
const roots: { [name in "missing" | "empty" | "full"]?: Workspace } = {};

function makeRoot(name: string, hiddenFiles: number | null): string {
  const root = path.join(base, name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "z-public.txt"), "VISIBLE\n");
  if (hiddenFiles !== null) {
    fs.mkdirSync(path.join(root, "a-hidden"));
    for (let index = 0; index < hiddenFiles; index += 1) fs.writeFileSync(path.join(root, "a-hidden", `h${index}.txt`), "VISIBLE\n");
  }
  return root;
}

before(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-v13-"));
  const missing = makeRoot("missing", null);
  const empty = makeRoot("empty", 0);
  const full = makeRoot("full", MAX_SEARCH_ENTRIES);
  roots.missing = await createWorkspace({ root: missing });
  roots.empty = await createWorkspace({ root: empty });
  roots.full = await createWorkspace({ root: full });
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

function workspaceOf(name: keyof typeof roots): Workspace {
  const found = roots[name];
  assert.ok(found !== undefined);
  return found;
}

const runner = (workspace: Workspace, unreadablePaths?: readonly string[]) =>
  createToolRunner({ workspace, privacy: createFakePrivacy(), ...(unreadablePaths === undefined ? {} : { unreadablePaths }) });

async function search(workspace: Workspace, args: Record<string, unknown>, unreadablePaths?: readonly string[]): Promise<RawToolOutcome> {
  return runner(workspace, unreadablePaths).execute({ id: "c1", name: "search_files", args } as never, never);
}
async function inspect(workspace: Workspace, args: Record<string, unknown>, unreadablePaths?: readonly string[]): Promise<RawWorkflowToolOutcome> {
  const tools = runner(workspace, unreadablePaths);
  assert.ok(tools.executeWorkflowTool !== undefined);
  return tools.executeWorkflowTool({ id: "c1", name: "inspect_files", args } as never, never);
}
const text = (value: unknown): string => JSON.stringify(value);

const SEARCHES: readonly Record<string, unknown>[] = [{ path: "." }, { path: ".", text: "VISIBLE" }, { path: ".", nameContains: "z-public" }];

const sameFolder = (a: string, b: string): boolean =>
  process.platform === "win32" ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

/**
 * fs.readdir with the folder `folder` answered by `answer`; the product's walks call it through this
 * same module object. Returns how many times that folder was read, and the restore.
 */
function replaceReaddir(folder: string, answer: () => Promise<Dirent[]>): { reads: () => number; restore: () => void } {
  const original = fsp.readdir.bind(fsp) as (...args: unknown[]) => Promise<unknown>;
  let reads = 0;
  const replaced = mock.method(fsp, "readdir", async (...args: unknown[]) => {
    if (typeof args[0] === "string" && sameFolder(args[0], folder)) {
      reads += 1;
      return answer();
    }
    return original(...args);
  });
  return { reads: () => reads, restore: () => replaced.mock.restore() };
}

describe("U-203 (V-13 M-1): search_files counts nothing under an unreadable path", () => {
  test("control: without unreadable paths a full folder takes the limit and the public file is gone", async () => {
    const outcome = await search(workspaceOf("full"), { path: ".", nameContains: "z-public" });
    assert.ok(outcome.ok, text(outcome));
    assert.equal(text(outcome.payload).includes("z-public.txt"), false);
    assert.equal((outcome.payload as { truncated: boolean }).truncated, true);
  });

  for (const args of SEARCHES) {
    test(`${text(args)}: the same result with the unreadable folder missing, empty or full`, async () => {
      const results: string[] = [];
      for (const name of ["missing", "empty", "full"] as const) {
        const outcome = await search(workspaceOf(name), args, HIDDEN);
        assert.ok(outcome.ok, `${name}: ${text(outcome)}`);
        if (!outcome.ok) return;
        const payload = outcome.payload as unknown as { entries: { path: string }[]; truncated: boolean; withheld?: true };
        assert.deepEqual(payload.entries.map((entry) => entry.path), ["z-public.txt"], name);
        assert.equal(payload.truncated, false, name);
        assert.equal(payload.withheld, true, name);
        results.push(text(payload));
      }
      assert.equal(new Set(results).size, 1, results.join("\n"));
    });
  }

  test("a folder under an unreadable path that cannot be read changes nothing: it is never read", async () => {
    const workspace = workspaceOf("empty");
    const plain = await search(workspace, { path: ".", text: "VISIBLE" }, HIDDEN);
    const failing = replaceReaddir(path.join(workspace.root, "a-hidden"), async () => {
      throw Object.assign(new Error("synthetic EACCES"), { code: "EACCES" });
    });
    try {
      const control = await search(workspace, { path: ".", text: "VISIBLE" });
      assert.deepEqual(control.ok ? null : control.code, "io_error", "the control reads it and fails");
      const readsBefore = failing.reads();
      const outcome = await search(workspace, { path: ".", text: "VISIBLE" }, HIDDEN);
      assert.equal(text(outcome), text(plain));
      assert.equal(failing.reads(), readsBefore, "the unreadable folder was not read");
    } finally {
      failing.restore();
    }
  });
});

describe("U-203 (V-13 M-1): inspect_files counts nothing under an unreadable path", () => {
  const manyFiles = (): Promise<Dirent[]> =>
    Promise.resolve(
      Array.from({ length: MAX_INSPECT_WALK_ENTRIES }, (_, index) => ({
        name: `h${index}.txt`,
        isDirectory: () => false,
        isFile: () => true,
        isSymbolicLink: () => false,
      })) as unknown as Dirent[],
    );

  test(`a listing of ${MAX_INSPECT_WALK_ENTRIES} entries under the unreadable folder does not reach the limit; the control does`, async () => {
    const workspace = workspaceOf("empty");
    const plain = await inspect(workspace, { path: ".", hash: true }, HIDDEN);
    assert.ok(plain.ok && text(plain.payload).includes("z-public.txt"), text(plain));
    const many = replaceReaddir(path.join(workspace.root, "a-hidden"), manyFiles);
    try {
      const control = await inspect(workspace, { path: "." });
      assert.deepEqual(control.ok ? null : control.code, "too_large", "the control counts the listing");
      const readsBefore = many.reads();
      const outcome = await inspect(workspace, { path: ".", hash: true }, HIDDEN);
      assert.equal(text(outcome), text(plain));
      assert.equal(many.reads(), readsBefore, "the unreadable folder was not read");
    } finally {
      many.restore();
    }
  });

  test("the same result with the unreadable folder missing, empty or full", async () => {
    const results: string[] = [];
    for (const name of ["missing", "empty", "full"] as const) {
      const outcome = await inspect(workspaceOf(name), { path: "." }, HIDDEN);
      assert.ok(outcome.ok, `${name}: ${text(outcome)}`);
      if (!outcome.ok || !("entries" in outcome.payload)) return;
      // modifiedAt differs between the roots' files; the paths, kinds and the rest must not.
      results.push(text({ ...outcome.payload, entries: outcome.payload.entries.map((entry) => [entry.path, entry.kind]) }));
    }
    assert.equal(new Set(results).size, 1, results.join("\n"));
  });
});

describe("U-203 (V-13 M-2): a name search does not show a link that leads under an unreadable path", () => {
  let workspace: Workspace;
  const made: { [name: string]: boolean } = {};

  before(async () => {
    const root = path.join(base, "alias");
    fs.mkdirSync(path.join(base, "outside-target"), { recursive: true });
    fs.mkdirSync(path.join(root, "private", "person-folder"), { recursive: true });
    fs.mkdirSync(path.join(root, "docs"));
    fs.writeFileSync(path.join(root, "private", "person-folder", "record.txt"), "synthetic record\n");
    fs.writeFileSync(path.join(root, "docs", "readme.md"), "synthetic readme\n");
    const links: [string, string][] = [
      ["person-alias", path.join(root, "private", "person-folder")],
      ["docs-alias", path.join(root, "docs")],
      ["gone-alias", path.join(root, "private", "gone")],
      ["outside-alias", path.join(base, "outside-target")],
    ];
    for (const [name, target] of links) {
      try {
        fs.symlinkSync(target, path.join(root, name), "junction");
        made[name] = true;
      } catch {
        made[name] = false;
      }
    }
    workspace = await createWorkspace({ root });
  });

  const paths = (outcome: RawToolOutcome): string[] => {
    assert.ok(outcome.ok, text(outcome));
    return outcome.ok ? (outcome.payload as unknown as { entries: { path: string }[] }).entries.map((entry) => entry.path) : [];
  };

  test("control: without unreadable paths the links are listed", async (t) => {
    if (made["person-alias"] !== true || made["docs-alias"] !== true) return t.skip("junctions cannot be made here");
    const listed = paths(await search(workspace, { path: ".", nameContains: "alias" }));
    assert.ok(listed.includes("person-alias") && listed.includes("docs-alias"), listed.join(","));
  });

  test("with private unreadable: person-alias is in no name search; docs-alias stays", async (t) => {
    if (made["person-alias"] !== true || made["docs-alias"] !== true) return t.skip("junctions cannot be made here");
    const all = paths(await search(workspace, { path: "." }, ["private"]));
    assert.equal(all.includes("person-alias"), false, all.join(","));
    assert.ok(all.includes("docs-alias") && all.includes("docs/readme.md"), all.join(","));
    assert.deepEqual(paths(await search(workspace, { path: ".", nameContains: "person" }, ["private"])), []);
  });

  test("a link whose real path cannot be found (a dangling one into private) is left out too", async (t) => {
    if (made["gone-alias"] !== true) return t.skip("a dangling junction cannot be made here");
    const control = paths(await search(workspace, { path: ".", nameContains: "gone" }));
    assert.deepEqual(control, ["gone-alias"], "the control lists it");
    assert.deepEqual(paths(await search(workspace, { path: ".", nameContains: "gone" }, ["private"])), []);
  });

  test("V-13b L-1: an empty list gives byte for byte the results without the option, the dangling and outside links included", async (t) => {
    if (made["gone-alias"] !== true || made["outside-alias"] !== true) return t.skip("these junctions cannot be made here");
    const without = paths(await search(workspace, { path: ".", nameContains: "alias" }));
    assert.ok(without.includes("gone-alias") && without.includes("outside-alias"), without.join(","));
    const calls: readonly Record<string, unknown>[] = [{ path: "." }, { path: ".", nameContains: "alias" }, { path: ".", text: "synthetic" }];
    for (const args of calls) {
      assert.equal(text(await search(workspace, args, [])), text(await search(workspace, args)), text(args));
    }
    assert.equal(text(await inspect(workspace, { path: ".", hash: true }, [])), text(await inspect(workspace, { path: ".", hash: true })));
  });

  test("V-13b L-1: a value that is not a list is unusable and still covers everything", async () => {
    const outcome = await search(workspace, { path: "." }, "private" as never);
    assert.ok(outcome.ok, text(outcome));
    const payload = outcome.payload as unknown as { entries: unknown[]; withheld?: true };
    assert.deepEqual(payload.entries, []);
    assert.equal(payload.withheld, true);
  });
});
