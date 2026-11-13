/**
 * U-175 (DR-69 B-2): compilePathSet, protected.ts's matcher made general.
 * - Side by side: the protected paths' decisions are what they were. A copy of the matcher as it
 *   was before U-175 (main f53af2b, src/policy/protected.ts) and the new compileProtectedPaths give
 *   the same answer for every list and path below, on the text and on real paths with links
 *   (inside, outside, dangling, in the state directory, below an entry). The format rule too.
 * - The new choices: `misses` (allow lists: an unusable list or entry covers nothing) and `exact`
 *   (an approved plan's files: the entry itself, nothing below it).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import type { CheckProtectedPaths, ProtectedPathProblem, Workspace } from "../../../src/contracts/index.js";
import { checkProtectedPaths, compileProtectedPaths } from "../../../src/policy/index.js";
import { compilePathSet } from "../../../src/policy/path-set.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { isValidPathInput } from "../../../src/workspace/lexical.js";

// ---- The matcher as it was before U-175 (main f53af2b, src/policy/protected.ts), for comparison. ----
const IS_WINDOWS = process.platform === "win32";
const ENTRY_SEPARATORS = IS_WINDOWS ? /[\\/]/ : /\//;
const fold = (segment: string): string => (IS_WINDOWS ? segment.toLowerCase() : segment);
const segmentsOf = (entry: string): string[] => entry.split(ENTRY_SEPARATORS).filter((segment) => segment !== "" && segment !== ".").map(fold);
function entryProblem(entry: unknown): ProtectedPathProblem["reason"] | null {
  if (typeof entry !== "string") return "not_a_string";
  if (entry.trim().length === 0) return "empty";
  if (entry.includes("\0")) return "invalid_name";
  if (path.isAbsolute(entry) || /^[\\/]/.test(entry) || /^[A-Za-z]:/.test(entry)) return "absolute";
  if (entry.split(ENTRY_SEPARATORS).includes("..")) return "parent_segment";
  if (!isValidPathInput(entry)) return "invalid_name";
  return null;
}
const legacyCheck: CheckProtectedPaths = (value) => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [{ index: null, reason: "not_a_list" }];
  const problems: ProtectedPathProblem[] = [];
  (value as readonly unknown[]).forEach((entry, index) => {
    const reason = entryProblem(entry);
    if (reason !== null) problems.push({ index, reason });
  });
  return problems;
};
interface Matcher {
  covers(relative: string): boolean;
  coversEffective(relative: string, workspace: Workspace): Promise<boolean>;
}
function prefixCovers(prefix: readonly string[], relative: string): boolean {
  const segments = relative === "." ? [] : relative.split("/").map(fold);
  return prefix.length <= segments.length && prefix.every((segment, index) => segment === segments[index]);
}
function legacyCompile(value: unknown): Matcher {
  if (legacyCheck(value).length > 0) return { covers: () => true, coversEffective: async () => true };
  const entries = (value ?? []) as readonly string[];
  if (entries.length === 0) return { covers: () => false, coversEffective: async () => false };
  const lexical = entries.map(segmentsOf);
  const covers = (relative: string): boolean => lexical.some((prefix) => prefixCovers(prefix, relative));
  return {
    covers,
    async coversEffective(relative, workspace) {
      if (covers(relative)) return true;
      for (const entry of entries) {
        const resolved = await workspace.resolve(entry, "read");
        if (!resolved.ok) {
          if (resolved.code === "state_dir") continue;
          return true;
        }
        if (prefixCovers(segmentsOf(resolved.path.relative), relative)) return true;
      }
      return false;
    },
  };
}
// ---- end of the copy ----

let base: string;
let root: string;
let workspace: Workspace;
let links = false;

function tryJunction(target: string, link: string): boolean {
  try {
    fs.symlinkSync(target, link, "junction");
    return true;
  } catch {
    return false;
  }
}

before(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-u175-"));
  root = path.join(base, "root");
  for (const dir of ["tests/sub", "tests2", "src", "docs", "out", ".codaryn/runs"]) fs.mkdirSync(path.join(root, dir), { recursive: true });
  for (const file of ["tests/a.test.ts", "tests/sub/b.ts", "tests2/a.ts", "src/a.ts", "docs/guide.md"]) fs.writeFileSync(path.join(root, file), "x\n");
  fs.mkdirSync(path.join(base, "outside"));
  fs.mkdirSync(path.join(base, "gone"));
  links =
    tryJunction(path.join(root, "src"), path.join(root, "link-in")) &&
    tryJunction(path.join(base, "outside"), path.join(root, "link-out")) &&
    tryJunction(path.join(base, "gone"), path.join(root, "dangling")) &&
    tryJunction(path.join(root, "src"), path.join(root, "out", "below"));
  fs.rmSync(path.join(base, "gone"), { recursive: true, force: true });
  workspace = await createWorkspace({ root });
});

after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

const LISTS: readonly unknown[] = [
  undefined,
  [],
  ["tests"],
  ["tests/"],
  ["./tests"],
  ["TESTS"],
  ["tests\\sub"],
  ["."],
  ["tests", "src/a.ts"],
  ["docs/guide.md"],
  ["missing/dir"],
  ["out"],
  [".codaryn"],
  [".codaryn/runs", "src"],
  ["link-in"],
  ["link-in/a.ts"],
  ["link-out"],
  ["link-out", "src"],
  ["dangling"],
  ["out/below"],
  "tests",
  ["/abs"],
  ["C:/x"],
  ["../up"],
  ["tests/../src"],
  [""],
  ["  "],
  [3],
  ["a\0b"],
  ["con"],
  ["tests", 7],
];

const RELATIVES: readonly string[] = [
  ".",
  "tests",
  "tests/a.test.ts",
  "tests/sub/b.ts",
  "Tests/Sub/B.ts",
  "tests2/a.ts",
  "src",
  "src/a.ts",
  "Src/A.ts",
  "docs/guide.md",
  "docs/guide.md/x",
  "docs/new.md",
  "out",
  "out/x",
  "out/below/a.ts",
  "missing/dir/f",
  "new/file.txt",
  "link-in",
  "link-in/a.ts",
  "link-out/a",
  ".codaryn/runs/x",
];

describe("U-175: the protected paths decide as before", () => {
  test("the format rule gives the same problems for every value", () => {
    for (const value of LISTS) assert.deepEqual(checkProtectedPaths(value), legacyCheck(value), JSON.stringify(value));
  });

  test("the same answer on the text and on real paths, for every list and path", async () => {
    let compared = 0;
    const answers = new Set<boolean>();
    for (const value of LISTS) {
      const now = compileProtectedPaths(value);
      const before = legacyCompile(value);
      for (const relative of RELATIVES) {
        const where = `${JSON.stringify(value)} ${relative}`;
        assert.equal(now.covers(relative), before.covers(relative), `covers ${where}`);
        const effective = await now.coversEffective(relative, workspace);
        assert.equal(effective, await before.coversEffective(relative, workspace), `coversEffective ${where}`);
        answers.add(effective);
        compared += 2;
      }
    }
    assert.equal(compared, LISTS.length * RELATIVES.length * 2);
    assert.deepEqual([...answers].sort(), [false, true], "both answers occur");
  });

  test("the cases that need links were really built (junctions)", { skip: !IS_WINDOWS && "junctions are a Windows case" }, () => {
    assert.ok(links, "the junctions could be made");
  });
});

describe("U-175: compilePathSet's new choices", () => {
  const allow = (value: unknown) => compilePathSet(value, { match: "prefix", onUnusable: "misses" });
  const exact = (value: unknown) => compilePathSet(value, { match: "exact", onUnusable: "misses" });

  test("an allow list that the format rule rejects covers nothing; a deny list covers everything", async () => {
    for (const value of ["tests", ["../up"], ["/abs"], [""], [3]]) {
      assert.equal(allow(value).covers("src/a.ts"), false, JSON.stringify(value));
      assert.equal(await allow(value).coversEffective("src/a.ts", workspace), false, JSON.stringify(value));
      assert.equal(compilePathSet(value, { match: "prefix", onUnusable: "covers" }).covers("src/a.ts"), true, JSON.stringify(value));
    }
  });

  test("an empty or absent list covers nothing either way", async () => {
    for (const onUnusable of ["covers", "misses"] as const) {
      for (const value of [undefined, []]) assert.equal(await compilePathSet(value, { match: "prefix", onUnusable }).coversEffective("src/a.ts", workspace), false);
    }
  });

  test("an unusable entry of an allow list is passed over; the others still cover", { skip: !links && "no junctions here" }, async () => {
    assert.equal(await allow(["link-out"]).coversEffective("src/a.ts", workspace), false);
    assert.equal(await allow(["dangling"]).coversEffective("src/a.ts", workspace), false);
    assert.equal(await allow(["link-out", "src"]).coversEffective("src/a.ts", workspace), true);
    assert.equal(await allow(["link-out", "docs"]).coversEffective("src/a.ts", workspace), false);
  });

  test("prefix: an entry covers what is below it; a link entry covers its real path", { skip: !links && "no junctions here" }, async () => {
    assert.equal(await allow(["docs"]).coversEffective("docs/new.md", workspace), true);
    assert.equal(await allow(["docs"]).coversEffective("docs2/a.md", workspace), false);
    assert.equal(await allow(["link-in"]).coversEffective("src/a.ts", workspace), true, "the entry's real path");
    assert.equal(await allow(["."]).coversEffective("anything/at/all", workspace), true);
  });

  test("exact: the entry itself, nothing below it and nothing beside it", async () => {
    const files = exact(["docs/guide.md", "docs/new.md"]);
    assert.equal(await files.coversEffective("docs/guide.md", workspace), true);
    assert.equal(await files.coversEffective("docs/new.md", workspace), true, "a file to create, not there yet");
    assert.equal(await files.coversEffective("docs/guide.md/x", workspace), false);
    assert.equal(await files.coversEffective("docs", workspace), false);
    assert.equal(await files.coversEffective("docs/other.md", workspace), false);
    assert.equal(await exact(["."]).coversEffective("docs/guide.md", workspace), false);
  });

  test("exact through a link entry: its real path, exactly", { skip: !links && "no junctions here" }, async () => {
    assert.equal(await exact(["link-in/a.ts"]).coversEffective("src/a.ts", workspace), true);
    assert.equal(await exact(["link-in"]).coversEffective("src/a.ts", workspace), false);
  });

  test("on Windows case does not matter, elsewhere it does", async () => {
    assert.equal(await allow(["Docs"]).coversEffective("docs/new.md", workspace), IS_WINDOWS);
    assert.equal(await exact(["DOCS/GUIDE.md"]).coversEffective("docs/guide.md", workspace), IS_WINDOWS);
  });
});
