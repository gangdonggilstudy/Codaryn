/**
 * Unit U-102 (review R-78 L-1, L-2 of U-89's listWorkspaceDir):
 * - L-1: `protected` judged the listed path by its letters only (`covers`), while the policy also
 *   judges a write by its real path (`coversEffective`). So the target of a protected link, a link
 *   into a protected folder, and a protected folder reached by its short name (8.3) read "not
 *   protected" although every write there is denied. `protected` now says what the policy says.
 * - L-2: a name holding an invisible character (default ignorable: zero width space, BOM, soft
 *   hyphen, Hangul filler and the like) was shown as it is, so two entries could look the same. Such
 *   a name now shows each of those characters as "?" and is masked (no `name`), so it can be neither
 *   opened nor chosen, and a `dir` holding one is refused before anything is read. The name is
 *   masked before the characters are replaced, so a key or a value split by one is still found.
 * Reproduced first (b35d7d1, todo until fixed). Temporary folders, fake values only.
 */

import assert from "node:assert/strict";
import { lstat, realpath, symlink, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { BUILTIN_TOOLS } from "../../../src/contracts/index.js";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, CodarynApp, TaskForm, WorkspaceDirListing } from "../../../src/app/index.js";
import { createPolicyGate } from "../../../src/policy/index.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { FAKE_SECRET, SECRET_ENV, appEnvironment, setupRun, taskForm } from "./support.js";

type Entry = { readonly name: string | null; readonly shown: string; readonly kind: string; readonly masked: boolean; readonly protected: boolean };
type Listing = { readonly status: string; readonly entries?: readonly Entry[] };

const POLICY = {
  commands: [],
  network: "deny",
  destructive: "deny",
  restorePathTokens: false,
  protectedPaths: ["notes.md", "Protected Folder Long", "alias"],
};

function ok(outcome: AppCallOutcome<WorkspaceDirListing>): Listing {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: WorkspaceDirListing }).output as Listing;
}

function byShown(listing: Listing): Map<string, Entry> {
  return new Map((listing.entries ?? []).map((entry) => [entry.shown, entry]));
}

/**
 * A workspace that protects `notes.md`, `Protected Folder Long` and `alias`, a junction to
 * `real-target`; `in-protected` is a junction into the protected folder, `to-plain` one to `plain`.
 */
async function protectedWorkspace(): Promise<{ work: string; app: CodarynApp; form: TaskForm }> {
  const base = await setupRun({ "notes.md": "n\n", "Protected Folder Long/inner.txt": "p\n", "real-target/t.txt": "t\n", "plain/x.txt": "x\n" }, { policy: POLICY }, []);
  const work = path.join(base, "work");
  await symlink(path.join(work, "real-target"), path.join(work, "alias"), "junction");
  await symlink(path.join(work, "Protected Folder Long"), path.join(work, "in-protected"), "junction");
  await symlink(path.join(work, "plain"), path.join(work, "to-plain"), "junction");
  return { work, app: createCodarynApp(await appEnvironment(base)), form: taskForm(base) };
}

/** The 8.3 short name of the protected folder, when the volume makes them (C: usually does). */
async function shortName(work: string): Promise<string | null> {
  try {
    const info = await lstat(path.join(work, "PROTEC~1"));
    return info.isDirectory() ? "PROTEC~1" : null;
  } catch {
    return null;
  }
}

/** Whether the policy gate denies a write to `relative` as a protected path (before or after links are resolved). */
async function policyProtects(work: string, relative: string): Promise<boolean> {
  const gate = createPolicyGate({ config: POLICY as never, workspace: await createWorkspace({ root: await realpath(work) }) });
  const call = { id: "c1", name: "write_file", args: { path: relative, expectedHash: null, change: { kind: "replace_all", content: "x" } } };
  const requested = gate.checkRequested(call, BUILTIN_TOOLS.write_file);
  if (!requested.allowed) return requested.code === "protected_path";
  const effective = await gate.checkEffective(call, BUILTIN_TOOLS.write_file);
  return !effective.allowed && effective.code === "protected_path";
}

const ZWSP = String.fromCodePoint(0x200b);
const BOM = String.fromCodePoint(0xfeff);
const SOFT_HYPHEN = String.fromCodePoint(0xad);
const HANGUL_FILLER = String.fromCodePoint(0x3164);
const INVISIBLES = [ZWSP, BOM, SOFT_HYPHEN, HANGUL_FILLER];

describe("U-102 L-1: protected says what the policy's write check says, real paths included", () => {
  test("the target of a protected link and a link into a protected folder are protected; others are not", async () => {
    const w = await protectedWorkspace();
    const root = byShown(ok(await w.app.listWorkspaceDir({ settings: w.form, dir: "", offset: 0 })));
    assert.deepEqual(
      ["notes.md", "Protected Folder Long", "alias", "real-target", "in-protected", "plain", "to-plain"].map((name) => [name, root.get(name)?.protected]),
      [
        ["notes.md", true],
        ["Protected Folder Long", true],
        ["alias", true],
        ["real-target", true],
        ["in-protected", true],
        ["plain", false],
        ["to-plain", false],
      ],
    );
    const target = byShown(ok(await w.app.listWorkspaceDir({ settings: w.form, dir: "real-target", offset: 0 })));
    assert.equal(target.get("t.txt")?.protected, true, "inside the target of the protected link `alias`");
    const plain = byShown(ok(await w.app.listWorkspaceDir({ settings: w.form, dir: "plain", offset: 0 })));
    assert.equal(plain.get("x.txt")?.protected, false);
  });

  test("a protected folder reached by its short name: its entries are protected", async (t) => {
    const w = await protectedWorkspace();
    const short = await shortName(w.work);
    if (short === null) {
      t.skip("this volume makes no 8.3 short names");
      return;
    }
    const inner = byShown(ok(await w.app.listWorkspaceDir({ settings: w.form, dir: short, offset: 0 })));
    assert.equal(inner.get("inner.txt")?.protected, true);
  });

  test("every entry of every listing agrees with the policy gate's write check", async () => {
    const w = await protectedWorkspace();
    const dirs = ["", "real-target", "plain", "Protected Folder Long", ...((await shortName(w.work)) === null ? [] : ["PROTEC~1"])];
    const differ: string[] = [];
    for (const dir of dirs) {
      for (const entry of ok(await w.app.listWorkspaceDir({ settings: w.form, dir, offset: 0 })).entries ?? []) {
        if (entry.name === null || entry.kind === "state") continue;
        const relative = dir === "" ? entry.name : `${dir}/${entry.name}`;
        if (entry.protected !== (await policyProtects(w.work, relative))) differ.push(`${relative}: listed ${String(entry.protected)}`);
      }
    }
    assert.deepEqual(differ, []);
  });
});

describe("U-102 L-2: a name with an invisible character shows it as ? and is masked", () => {
  test("zero width space, BOM, soft hyphen, Hangul filler: shown with ?, masked, no name, the character nowhere", async () => {
    const base = await setupRun({ "report.txt": "r\n" }, {}, []);
    const work = path.join(base, "work");
    for (const [index, char] of INVISIBLES.entries()) await writeFile(path.join(work, `re${char}port-${index}.txt`), "x\n");
    const app = createCodarynApp(await appEnvironment(base));
    const listing = ok(await app.listWorkspaceDir({ settings: taskForm(base), dir: "", offset: 0 }));
    const shown = byShown(listing);
    for (const index of INVISIBLES.keys()) {
      const entry = shown.get(`re?port-${index}.txt`);
      assert.deepEqual([entry?.masked, entry?.name], [true, null], `name ${index}`);
    }
    assert.deepEqual([shown.get("report.txt")?.masked, shown.get("report.txt")?.name], [false, "report.txt"]);
    const text = JSON.stringify(listing);
    assert.equal(INVISIBLES.some((char) => text.includes(char)), false, "no invisible character in the listing");
  });

  test("a directory so named cannot be listed by its real name; a registered value split by one stays masked", async () => {
    const base = await setupRun({}, {}, []);
    const work = path.join(base, "work");
    await mkdir(path.join(work, `dir${ZWSP}x`));
    const half = Math.floor(FAKE_SECRET.length / 2);
    await writeFile(path.join(work, `s-${FAKE_SECRET.slice(0, half)}${ZWSP}${FAKE_SECRET.slice(half)}.txt`), "s\n");
    const app = createCodarynApp(await appEnvironment(base));
    const listing = ok(await app.listWorkspaceDir({ settings: taskForm(base), dir: "", offset: 0 }));
    const dir = byShown(listing).get("dir?x");
    assert.deepEqual([dir?.kind, dir?.masked, dir?.name], ["dir", true, null]);
    const outcome = await app.listWorkspaceDir({ settings: taskForm(base), dir: `dir${ZWSP}x`, offset: 0 });
    assert.equal(outcome.ok ? outcome.output.status : outcome.error.code, "invalid_arguments");
    const text = JSON.stringify(listing);
    assert.equal(text.includes(FAKE_SECRET.slice(0, half)) || text.includes(FAKE_SECRET.slice(half)), false, "neither half of the value is shown");
  });

  test("a key shape and a key value set now, split by an invisible character, stay hidden (masked before ? is shown)", async () => {
    const base = await setupRun({}, {}, []);
    const work = path.join(base, "work");
    // Built here so no source holds a key shape (G-10); the key value is a fake, not key-shaped.
    const keyShaped = ["sk", "ant", "api03", "FAKE".repeat(20)].join("-");
    const keyValue = `fake-openai-value-${"q".repeat(24)}`;
    await writeFile(path.join(work, `${keyShaped.slice(0, 20)}${ZWSP}${keyShaped.slice(20)}.txt`), "k\n");
    await writeFile(path.join(work, `v-${keyValue.slice(0, 10)}${ZWSP}${keyValue.slice(10)}.txt`), "v\n");
    const app = createCodarynApp(await appEnvironment(base, { env: { [SECRET_ENV]: FAKE_SECRET, OPENAI_API_KEY: keyValue } }));
    const listing = ok(await app.listWorkspaceDir({ settings: taskForm(base), dir: "", offset: 0 }));
    const text = JSON.stringify(listing);
    assert.equal(text.includes(keyShaped.slice(24)), false, "no part of the key shape after the split");
    assert.equal(text.includes(keyValue.slice(10)), false, "no part of the key value after the split");
    assert.equal((listing.entries ?? []).filter((entry) => entry.masked && entry.name === null).length, 2);
  });
});
