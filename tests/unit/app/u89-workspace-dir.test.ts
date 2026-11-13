/**
 * Unit U-89 (gap survey, GUI 3.3, PM: the draft's form and security requirements adopted): the app
 * layer lists one directory of a workspace for an adapter's file tree, `listWorkspaceDir`.
 * - The settings are a task form: the workspace and the values registered now for masking (as
 *   `changes`, U-17), and the protected paths.
 * - Paths go through the engine's workspace rules; a link or junction is listed as `link` and never
 *   followed, and a path through one is refused; the root's `.codaryn` is `state`.
 * - Names are shown masked (control characters, key shapes, the current keys, the registered
 *   values). The real name of a masked entry never leaves the app layer (`name: null`).
 * - Pages of 500; a directory past the limit is `too_large`, never listed in part.
 * - Reads only: no lock, no records.
 * Reproduced first (todo until the app layer gives it). Temporary folders, fake values only.
 */

import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, CodarynApp, TaskForm } from "../../../src/app/index.js";
import { FAKE_SECRET, SECRET_ENV, appEnvironment, exists, setupRun, taskForm } from "./support.js";

const TODO = { todo: "U-89: the app layer has no listWorkspaceDir yet" };

type Listing = {
  readonly kind: "workspace_dir";
  readonly status: string;
  readonly masking?: string;
  readonly entries?: readonly { readonly name: string | null; readonly shown: string; readonly kind: string; readonly masked: boolean; readonly protected: boolean }[];
  readonly total?: number;
  readonly offset?: number;
  readonly nextOffset?: number | null;
};
type ListFn = (request: { readonly settings: TaskForm; readonly dir: string; readonly offset: number; readonly limit?: number }) => Promise<AppCallOutcome<Listing>>;

/** A key-shaped name, built here so no source holds one (G-10). */
const KEY_SHAPED = ["sk", "ant", "api03", "FAKE".repeat(20)].join("-");

function list(app: CodarynApp): ListFn {
  const fn = (app as unknown as Record<string, unknown>)["listWorkspaceDir"];
  assert.equal(typeof fn, "function", "the app layer gives listWorkspaceDir");
  return (fn as ListFn).bind(app);
}

function ok(outcome: AppCallOutcome<Listing>): Listing {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: Listing }).output;
}

/** A workspace with every kind of entry; the task protects `docs` and registers FAKE_SECRET. */
async function workspace(): Promise<{ base: string; work: string; app: CodarynApp; form: TaskForm }> {
  const base = await setupRun({ "a.txt": "a\n", "docs/guide.md": "g\n", "sub/inner.txt": "i\n", [`note-${FAKE_SECRET}.txt`]: "s\n", [`${KEY_SHAPED}.txt`]: "k\n" }, {
    policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, protectedPaths: ["docs"] },
  }, []);
  const work = path.join(base, "work");
  await mkdir(path.join(work, ".codaryn"), { recursive: true });
  await mkdir(path.join(base, "outside"), { recursive: true });
  // A junction (no privilege needed on Windows) to a folder outside the workspace, and one inside.
  await symlink(path.join(base, "outside"), path.join(work, "out-link"), "junction");
  await symlink(path.join(work, "sub"), path.join(work, "in-link"), "junction");
  // A bidirectional control character is allowed in a Windows file name; cleanText replaces it.
  await writeFile(path.join(work, `odd${String.fromCodePoint(0x202e)}name.txt`), "o\n");
  const app = createCodarynApp(await appEnvironment(base));
  return { base, work, app, form: taskForm(base) };
}

describe("U-89: listWorkspaceDir lists one directory, masked, without following links", () => {
  test("the root: kinds, order (directories first), protected, state, links not followed", TODO, async () => {
    const w = await workspace();
    const listing = ok(await list(w.app)({ settings: w.form, dir: "", offset: 0 }));
    assert.equal(listing.status, "listed");
    assert.equal(listing.masking, "current_secrets");
    const byShown = new Map((listing.entries ?? []).map((entry) => [entry.shown, entry]));
    assert.deepEqual(byShown.get(".codaryn")?.kind, "state");
    assert.deepEqual(byShown.get("out-link")?.kind, "link");
    assert.deepEqual(byShown.get("in-link")?.kind, "link");
    assert.deepEqual([byShown.get("docs")?.kind, byShown.get("docs")?.protected], ["dir", true]);
    assert.deepEqual([byShown.get("a.txt")?.kind, byShown.get("a.txt")?.protected, byShown.get("a.txt")?.name], ["file", false, "a.txt"]);
    const kinds = (listing.entries ?? []).map((entry) => entry.kind);
    const lastDir = kinds.lastIndexOf("dir");
    const firstOther = kinds.findIndex((kind) => kind !== "dir" && kind !== "state");
    assert.ok(lastDir < firstOther, `directories first: ${kinds.join(",")}`);
    assert.equal(listing.total, listing.entries?.length);
    assert.equal(listing.nextOffset, null);
  });

  test("names: a registered value, a key shape and a control character are masked; the real name stays in", TODO, async () => {
    const w = await workspace();
    const listing = ok(await list(w.app)({ settings: w.form, dir: "", offset: 0 }));
    const text = JSON.stringify(listing);
    assert.equal(text.includes(FAKE_SECRET), false, "no registered value");
    assert.equal(text.includes(KEY_SHAPED), false, "no key shape");
    assert.equal(text.includes(String.fromCodePoint(0x202e)), false, "no control character");
    const masked = (listing.entries ?? []).filter((entry) => entry.masked);
    assert.equal(masked.length, 3, JSON.stringify(masked));
    assert.ok(masked.every((entry) => entry.name === null), "a masked entry has no name");
  });

  test("a sub-directory; refused, not found and not a directory; nothing through a link", TODO, async () => {
    const w = await workspace();
    const sub = ok(await list(w.app)({ settings: w.form, dir: "sub", offset: 0 }));
    assert.deepEqual(sub.entries?.map((entry) => [entry.shown, entry.kind]), [["inner.txt", "file"]]);
    for (const dir of [".codaryn", "out-link", "in-link", "in-link/x"]) {
      assert.equal(ok(await list(w.app)({ settings: w.form, dir, offset: 0 })).status, "refused", dir);
    }
    assert.equal(ok(await list(w.app)({ settings: w.form, dir: "missing", offset: 0 })).status, "not_found");
    assert.equal(ok(await list(w.app)({ settings: w.form, dir: "a.txt", offset: 0 })).status, "not_dir");
  });

  test("arguments that do not fit are invalid_arguments before anything is read", TODO, async () => {
    const w = await workspace();
    for (const request of [
      { dir: "../x", offset: 0 },
      { dir: "/abs", offset: 0 },
      { dir: "C:/x", offset: 0 },
      { dir: "a//b", offset: 0 },
      { dir: "a/./b", offset: 0 },
      { dir: "sub", offset: -1 },
      { dir: "sub", offset: 1.5 },
      { dir: "sub", offset: 0, limit: 0 },
      { dir: "sub", offset: 0, limit: 501 },
    ]) {
      const outcome = await list(w.app)({ settings: w.form, ...request });
      assert.equal(outcome.ok ? "ok" : outcome.error.code, "invalid_arguments", JSON.stringify(request));
    }
  });

  test("pages of 500 in a fixed order; an offset past the end is an empty page", TODO, async () => {
    const base = await setupRun({}, {}, []);
    const work = path.join(base, "work");
    await mkdir(path.join(work, "many"));
    for (let i = 0; i < 1203; i += 1) await writeFile(path.join(work, "many", `f${i}.txt`), "");
    const app = createCodarynApp(await appEnvironment(base));
    const pages: Listing[] = [];
    for (let offset: number | null = 0; offset !== null; offset = pages.at(-1)?.nextOffset ?? null) pages.push(ok(await list(app)({ settings: taskForm(base), dir: "many", offset })));
    assert.deepEqual(pages.map((page) => page.entries?.length), [500, 500, 203]);
    assert.deepEqual(pages.map((page) => page.total), [1203, 1203, 1203]);
    assert.deepEqual(pages[1]?.entries?.[0]?.shown, "f500.txt", "numeric order");
    assert.deepEqual(ok(await list(app)({ settings: taskForm(base), dir: "many", offset: 5000 })).entries, []);
  });

  test("reads only: no state directory, lock or run is made", TODO, async () => {
    const base = await setupRun({ "a.txt": "a\n" }, {}, []);
    const app = createCodarynApp(await appEnvironment(base));
    ok(await list(app)({ settings: taskForm(base), dir: "", offset: 0 }));
    assert.equal(await exists(path.join(base, "work", ".codaryn")), false);
  });

  test("settings that do not resolve give their error and nothing is listed", TODO, async () => {
    const base = await setupRun({ "a.txt": "a\n" }, {}, []);
    const app = createCodarynApp(await appEnvironment(base, { env: {} }));
    const outcome = await list(app)({ settings: taskForm(base), dir: "", offset: 0 });
    assert.equal(outcome.ok ? "ok" : outcome.error.code, "secret_env_missing", `the task registers ${SECRET_ENV}`);
  });
});
