/**
 * Unit U-172 (DR-72, text-editing-ux 5, the GUI's study 2.2-2.3): the app layer reads a text file of
 * the workspace for a person (`readWorkspaceText`) and writes the person's edit (`writeWorkspaceText`).
 * - Read: a path inside the workspace only (the engine's rules, every segment looked at with lstat:
 *   a link or junction, the state directory and anything outside are refused), up to MAX_READ_BYTES,
 *   UTF-8 text only. It gives the text as shown (masked with the values registered now, key values
 *   and key shapes hidden, control characters replaced), whether masking changed it, whether it is
 *   protected, the line ending and BOM, the digest of the bytes read, and whether it can be edited
 *   here and why not. It takes no lock and makes nothing.
 * - Write: judged again (the window is not trusted), only when the file's digest is still the one
 *   read, under the workspace lock a run takes, with the line ending and BOM put back, atomically;
 *   nothing goes into the run records.
 * Reproduced first (todo until the app layer gives them). Temporary folders, fake values only.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, link, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import type { CodarynApp, TaskForm } from "../../../src/app/index.js";
import { acquireLock, releaseLock } from "../../../src/store/index.js";
import { FAKE_SECRET, appEnvironment, exists, setupRun, taskForm } from "./support.js";

const TODO = { todo: "U-172: the app layer has no readWorkspaceText or writeWorkspaceText yet" };

/** A key-shaped text, built here so no source holds one (G-10). */
const KEY_SHAPED = ["sk", "ant", "api03", "FAKE".repeat(20)].join("-");
const BOM = String.fromCodePoint(0xfeff);
const ESC = String.fromCharCode(0x1b);
const RLO = String.fromCodePoint(0x202e);
const LOCK_ID = "20261113T000000Z-0000abcd";
const MAX = 262_144;

type Text = {
  readonly kind: string;
  readonly status: string;
  readonly path?: string;
  readonly text?: string;
  readonly masked?: boolean;
  readonly protected?: boolean;
  readonly lineEnding?: string;
  readonly bom?: boolean;
  readonly digest?: string;
  readonly bytes?: number;
  readonly editable?: boolean;
  readonly readOnlyReasons?: readonly string[];
};
type Written = {
  readonly kind: string;
  readonly status: string;
  readonly digest: string | null;
  readonly readOnlyReasons: readonly string[];
  readonly textProblems: readonly string[];
  readonly lockLeft: boolean;
};
type Outcome<T> = { readonly ok: true; readonly output: T } | { readonly ok: false; readonly error: { readonly code: string } };

function call<T>(app: CodarynApp, name: "readWorkspaceText" | "writeWorkspaceText", request: unknown): Promise<Outcome<T>> {
  const fn = (app as unknown as Record<string, unknown>)[name];
  assert.equal(typeof fn, "function", `the app layer gives ${name}`);
  return (fn as (request: unknown) => Promise<Outcome<T>>).call(app, request);
}
const read = (app: CodarynApp, request: unknown) => call<Text>(app, "readWorkspaceText", request);
const write = (app: CodarynApp, request: unknown) => call<Written>(app, "writeWorkspaceText", request);

function ok<T>(outcome: Outcome<T>): T {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: T }).output;
}
const sha = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");

interface Fixture {
  readonly base: string;
  readonly work: string;
  readonly app: CodarynApp;
  readonly form: TaskForm;
}

/** A workspace (task file outside it registers FAKE_SECRET, protects `tests`) with the given files. */
async function fixture(files: Readonly<Record<string, string | Buffer>> = {}, formOverrides: Partial<TaskForm> = {}): Promise<Fixture> {
  const base = await setupRun({}, { policy: { commands: [], network: "deny", destructive: "deny", restorePathTokens: false, protectedPaths: ["tests"] } }, []);
  const work = path.join(base, "work");
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(work, name)), { recursive: true });
    await writeFile(path.join(work, name), content);
  }
  const app = createCodarynApp(await appEnvironment(base));
  return { base, work, app, form: taskForm(base, formOverrides) };
}

describe("U-172: readWorkspaceText gives a file as shown, with what decides whether it can be edited", () => {
  test("a plain LF file: its text, digest and line ending; editable", TODO, async () => {
    const f = await fixture({ "notes/a.md": "# Notes\n\n- one\n" });
    const text = ok(await read(f.app, { settings: f.form, path: "notes/a.md" }));
    assert.deepEqual(
      { kind: text.kind, status: text.status, path: text.path, text: text.text, masked: text.masked, protected: text.protected, lineEnding: text.lineEnding, bom: text.bom, editable: text.editable, reasons: text.readOnlyReasons },
      { kind: "workspace_text", status: "opened", path: "notes/a.md", text: "# Notes\n\n- one\n", masked: false, protected: false, lineEnding: "lf", bom: false, editable: true, reasons: [] },
    );
    assert.equal(text.digest, sha("# Notes\n\n- one\n"));
    assert.equal(text.bytes, Buffer.byteLength("# Notes\n\n- one\n"));
    assert.equal(await exists(path.join(f.work, ".codaryn")), false, "reading makes no state directory");
  });

  test("CRLF with a BOM: shown with LF and without the BOM, both told; editable", TODO, async () => {
    const f = await fixture({ "win.txt": `${BOM}one\r\ntwo\r\n` });
    const text = ok(await read(f.app, { settings: f.form, path: "win.txt" }));
    assert.deepEqual([text.text, text.lineEnding, text.bom, text.editable], ["one\ntwo\n", "crlf", true, true]);
    assert.equal(text.digest, sha(Buffer.from(`${BOM}one\r\ntwo\r\n`, "utf8")));
  });

  test("a registered value, a key shape: masked in the text, read only (masked)", TODO, async () => {
    const f = await fixture({ "secret.txt": `password=${FAKE_SECRET}\n`, "key.txt": `key ${KEY_SHAPED}\n` });
    for (const file of ["secret.txt", "key.txt"]) {
      const text = ok(await read(f.app, { settings: f.form, path: file }));
      const json = JSON.stringify(text);
      assert.equal(json.includes(FAKE_SECRET) || json.includes(KEY_SHAPED), false, `${file}: nothing of the value`);
      assert.deepEqual([text.masked, text.editable, text.readOnlyReasons], [true, false, ["masked"]], file);
    }
  });

  test("control characters, mixed line endings: replaced or told, read only", TODO, async () => {
    const f = await fixture({ "esc.txt": `a${ESC}[2Jb\n`, "bidi.txt": `x${RLO}y\n`, "mixed.txt": "a\r\nb\nc\r\n", "cr.txt": "a\rb\n" });
    const esc = ok(await read(f.app, { settings: f.form, path: "esc.txt" }));
    assert.deepEqual([esc.text, esc.masked, esc.editable, esc.readOnlyReasons], ["a?[2Jb\n", false, false, ["control_characters"]]);
    const bidi = ok(await read(f.app, { settings: f.form, path: "bidi.txt" }));
    assert.deepEqual([bidi.text, bidi.readOnlyReasons], ["x?y\n", ["control_characters"]]);
    const mixed = ok(await read(f.app, { settings: f.form, path: "mixed.txt" }));
    assert.deepEqual([mixed.text, mixed.lineEnding, mixed.readOnlyReasons], ["a\nb\nc\n", "mixed", ["mixed_line_endings"]]);
    const cr = ok(await read(f.app, { settings: f.form, path: "cr.txt" }));
    assert.deepEqual([cr.text, cr.lineEnding, cr.readOnlyReasons], ["a?b\n", "mixed", ["control_characters", "mixed_line_endings"]]);
  });

  test("protected, a file the settings name, read-only attribute, a hard link: read only, each told", TODO, async () => {
    const f = await fixture(
      { "tests/check.txt": "t\n", "conf.json": '{ "schemaVersion": 1 }\n', "vars.env": "X_VALUE=1\n", "ro.txt": "r\n", "linked.txt": "l\n" },
      {},
    );
    await chmod(path.join(f.work, "ro.txt"), 0o444);
    await link(path.join(f.work, "linked.txt"), path.join(f.work, "second-name.txt"));
    const form = taskForm(f.base, { configPath: path.join(f.work, "conf.json"), varsFile: path.join(f.work, "vars.env") });
    const reasons = async (file: string) => {
      const text = ok(await read(f.app, { settings: form, path: file }));
      return [text.editable, text.readOnlyReasons, text.protected];
    };
    assert.deepEqual(await reasons("tests/check.txt"), [false, ["protected"], true]);
    assert.deepEqual(await reasons("conf.json"), [false, ["settings_file"], false]);
    assert.deepEqual(await reasons("vars.env"), [false, ["settings_file"], false]);
    assert.deepEqual(await reasons("ro.txt"), [false, ["read_only"], false]);
    assert.deepEqual(await reasons("linked.txt"), [false, ["hard_link"], false]);
    await chmod(path.join(f.work, "ro.txt"), 0o644);
  });

  test("while a run holds the workspace lock: read only (workspace_locked)", TODO, async () => {
    const f = await fixture({ "a.txt": "a\n" });
    const lock = await acquireLock({ workspaceRoot: f.work, runId: LOCK_ID, clock: { now: () => Date.now() } });
    assert.equal(lock.ok, true);
    try {
      const text = ok(await read(f.app, { settings: f.form, path: "a.txt" }));
      assert.deepEqual([text.text, text.editable, text.readOnlyReasons], ["a\n", false, ["workspace_locked"]]);
    } finally {
      await releaseLock({ workspaceRoot: f.work, runId: LOCK_ID });
    }
    assert.equal(ok(await read(f.app, { settings: f.form, path: "a.txt" })).editable, true, "editable again once the lock is gone");
  });

  test("what is not opened: a link, the state directory, missing, a directory, too large, not text", TODO, async () => {
    const f = await fixture({ "sub/in.txt": "i\n", "big.txt": "x".repeat(MAX + 1), "nul.bin": Buffer.from([0x61, 0x00, 0x62]), "latin.txt": Buffer.from([0x63, 0x61, 0x66, 0xe9]) });
    await mkdir(path.join(f.base, "outside"), { recursive: true });
    await writeFile(path.join(f.base, "outside", "o.txt"), "outside\n");
    await symlink(path.join(f.base, "outside"), path.join(f.work, "out-link"), "junction");
    await mkdir(path.join(f.work, ".codaryn"), { recursive: true });
    await writeFile(path.join(f.work, ".codaryn", "x.txt"), "state\n");
    const status = async (file: string) => {
      const text = ok(await read(f.app, { settings: f.form, path: file }));
      assert.equal(text.text, undefined, `${file}: no text`);
      return text.status;
    };
    assert.equal(await status("out-link/o.txt"), "refused");
    assert.equal(await status(".codaryn/x.txt"), "refused");
    assert.equal(await status(".CODARYN/x.txt"), "refused");
    assert.equal(await status("none.txt"), "not_found");
    assert.equal(await status("sub"), "not_file");
    assert.equal(await status("big.txt"), "too_large");
    assert.equal(await status("nul.bin"), "not_text");
    assert.equal(await status("latin.txt"), "not_text");
  });

  test("a path that is not plain relative segments is invalid_arguments; nothing is read", TODO, async () => {
    const f = await fixture({ "a.txt": "a\n" });
    for (const bad of ["", "../task.json", "a/../a.txt", "./a.txt", "/a.txt", "C:/a.txt", "a\\b.txt", "a//b", 42]) {
      const outcome = await read(f.app, { settings: f.form, path: bad });
      assert.equal(outcome.ok, false, JSON.stringify(bad));
      assert.equal((outcome as { error: { code: string } }).error.code, "invalid_arguments", JSON.stringify(bad));
    }
  });
});

describe("U-172: writeWorkspaceText writes a person's edit only as the read allowed it", () => {
  const opened = async (f: Fixture, file: string): Promise<Text> => ok(await read(f.app, { settings: f.form, path: file }));

  test("an LF file: written, the digest the next save starts from; no run record, no lock left", TODO, async () => {
    const f = await fixture({ "a.md": "old line\n" });
    const before = await opened(f, "a.md");
    const written = ok(await write(f.app, { settings: f.form, path: "a.md", text: "new line\nsecond\n", baseDigest: before.digest }));
    assert.deepEqual([written.kind, written.status, written.lockLeft, written.readOnlyReasons, written.textProblems], ["workspace_text_write", "written", false, [], []]);
    assert.equal(await readFile(path.join(f.work, "a.md"), "utf8"), "new line\nsecond\n");
    assert.equal(written.digest, sha("new line\nsecond\n"));
    assert.equal((await opened(f, "a.md")).digest, written.digest);
    assert.equal(await exists(path.join(f.work, ".codaryn", "lock.json")), false, "the lock is taken back");
    assert.equal(await exists(path.join(f.work, ".codaryn", "runs")), false, "no run records");
    const left = (await readdir(f.work)).filter((name) => name.includes("codaryn-tmp"));
    assert.deepEqual(left, [], "no temporary file left");
  });

  test("CRLF with a BOM: the window's LF text is written back with CRLF and the BOM", TODO, async () => {
    const f = await fixture({ "win.txt": `${BOM}one\r\ntwo\r\n` });
    const before = await opened(f, "win.txt");
    const written = ok(await write(f.app, { settings: f.form, path: "win.txt", text: "one\ntwo\nthree\n", baseDigest: before.digest }));
    assert.equal(written.status, "written");
    const bytes = await readFile(path.join(f.work, "win.txt"));
    assert.equal(bytes.toString("utf8"), `${BOM}one\r\ntwo\r\nthree\r\n`);
    assert.equal(written.digest, sha(bytes));
  });

  test("the file changed after it was read: conflict, the other change stays", TODO, async () => {
    const f = await fixture({ "a.txt": "first\n" });
    const before = await opened(f, "a.txt");
    await writeFile(path.join(f.work, "a.txt"), "changed by another editor\n");
    const written = ok(await write(f.app, { settings: f.form, path: "a.txt", text: "mine\n", baseDigest: before.digest }));
    assert.deepEqual([written.status, written.digest], ["conflict", null]);
    assert.equal(await readFile(path.join(f.work, "a.txt"), "utf8"), "changed by another editor\n");
  });

  test("a run holds the workspace: workspace_locked, nothing written", TODO, async () => {
    const f = await fixture({ "a.txt": "first\n" });
    const before = await opened(f, "a.txt");
    const lock = await acquireLock({ workspaceRoot: f.work, runId: LOCK_ID, clock: { now: () => Date.now() } });
    assert.equal(lock.ok, true);
    try {
      const written = ok(await write(f.app, { settings: f.form, path: "a.txt", text: "mine\n", baseDigest: before.digest }));
      assert.equal(written.status, "workspace_locked");
      assert.equal(await readFile(path.join(f.work, "a.txt"), "utf8"), "first\n");
    } finally {
      await releaseLock({ workspaceRoot: f.work, runId: LOCK_ID });
    }
  });

  test("judged again: a masked or protected file is not written even with its own digest", TODO, async () => {
    const f = await fixture({ "secret.txt": `password=${FAKE_SECRET}\n`, "tests/check.txt": "t\n" });
    for (const [file, reason] of [["secret.txt", "masked"], ["tests/check.txt", "protected"]] as const) {
      const raw = await readFile(path.join(f.work, file));
      const written = ok(await write(f.app, { settings: f.form, path: file, text: "replaced\n", baseDigest: sha(raw) }));
      assert.deepEqual([written.status, written.readOnlyReasons], ["not_editable", [reason]], file);
      assert.deepEqual(await readFile(path.join(f.work, file)), raw, `${file} stays`);
    }
  });

  test("a new text that masking would change, or with control characters, or too large: refused", TODO, async () => {
    const f = await fixture({ "a.txt": "a\n" });
    const before = await opened(f, "a.txt");
    const cases: [string, string][] = [
      [`token ${FAKE_SECRET}\n`, "masked"],
      [`key ${KEY_SHAPED}\n`, "masked"],
      ["line\r\nother\n", "control_characters"],
      [`a${ESC}b\n`, "control_characters"],
      [`a${RLO}b\n`, "control_characters"],
      ["y".repeat(MAX + 1), "too_large"],
    ];
    for (const [text, problem] of cases) {
      const written = ok(await write(f.app, { settings: f.form, path: "a.txt", text, baseDigest: before.digest }));
      assert.deepEqual([written.status, written.textProblems], ["text_refused", [problem]], JSON.stringify(text.slice(0, 40)));
    }
    assert.equal(await readFile(path.join(f.work, "a.txt"), "utf8"), "a\n");
  });

  test("the same text: unchanged, nothing written", TODO, async () => {
    const f = await fixture({ "a.txt": "same\n" });
    const before = await opened(f, "a.txt");
    const written = ok(await write(f.app, { settings: f.form, path: "a.txt", text: "same\n", baseDigest: before.digest }));
    assert.deepEqual([written.status, written.digest], ["unchanged", before.digest]);
  });

  test("through a link, the state directory, a missing file: not written; the outside file stays", TODO, async () => {
    const f = await fixture({ "a.txt": "a\n" });
    await mkdir(path.join(f.base, "outside"), { recursive: true });
    await writeFile(path.join(f.base, "outside", "o.txt"), "outside\n");
    await symlink(path.join(f.base, "outside"), path.join(f.work, "out-link"), "junction");
    const digest = sha("outside\n");
    for (const [file, status] of [["out-link/o.txt", "refused"], [".codaryn/lock.json", "refused"], ["none.txt", "not_found"]] as const) {
      const written = ok(await write(f.app, { settings: f.form, path: file, text: "x\n", baseDigest: digest }));
      assert.equal(written.status, status, file);
    }
    assert.equal(await readFile(path.join(f.base, "outside", "o.txt"), "utf8"), "outside\n");
  });

  test("arguments that do not fit are invalid_arguments; nothing is read or locked", TODO, async () => {
    const f = await fixture({ "a.txt": "a\n" });
    const digest = sha("a\n");
    const bad: unknown[] = [
      { settings: f.form, path: "../a.txt", text: "x", baseDigest: digest },
      { settings: f.form, path: "a.txt", text: 42, baseDigest: digest },
      { settings: f.form, path: "a.txt", text: "x", baseDigest: "abc" },
      { settings: f.form, path: "a.txt", text: `x${String.fromCharCode(0xd800)}`, baseDigest: digest },
      { settings: f.form, path: "a.txt", text: "x" },
    ];
    for (const request of bad) {
      const outcome = await write(f.app, request);
      assert.equal(outcome.ok, false);
      assert.equal((outcome as { error: { code: string } }).error.code, "invalid_arguments");
    }
    assert.equal(await exists(path.join(f.work, ".codaryn")), false, "no state directory, no lock");
  });
});
