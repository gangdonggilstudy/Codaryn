import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { checkLocalPathSyntax, locateInWorkspace } from "../../../../src/cli/security/index.js";
import type { RealpathFs } from "../../../../src/cli/security/index.js";

const IS_WINDOWS = process.platform === "win32";

describe("S-5 checkLocalPathSyntax (strings only)", () => {
  test("rejects UNC paths on Windows", () => {
    for (const input of [
      "\\\\attacker.invalid\\share",
      "\\\\attacker.invalid\\share\\task.json",
      "//attacker.invalid/share/codaryn.json",
      "\\/attacker.invalid/share",
    ]) {
      assert.deepEqual(checkLocalPathSyntax(input, "win32"), { ok: false, reason: "unc" }, input);
    }
  });

  test("rejects device namespace paths and DOS device names on Windows", () => {
    for (const input of [
      "\\\\?\\C:\\work\\task.json",
      "\\\\.\\C:\\work\\task.json",
      "\\\\.\\pipe\\codaryn",
      "\\??\\C:\\work\\task.json",
      "NUL",
      "con.json",
      "C:\\work\\COM1",
      "C:\\work\\lpt9.txt",
      "work\\aux\\task.json",
      "C:\\work\\CONIN$",
    ]) {
      assert.deepEqual(checkLocalPathSyntax(input, "win32"), { ok: false, reason: "device" }, input);
    }
  });

  test("accepts ordinary Windows paths", () => {
    for (const input of ["C:\\work\\task.json", "task.json", ".\\cfg\\codaryn.json", "D:/work/config.json", "..\\x.json", "console.json", "nullable.json"]) {
      assert.deepEqual(checkLocalPathSyntax(input, "win32"), { ok: true }, input);
    }
  });

  test("rejects empty paths and NUL characters on every platform", () => {
    for (const platform of ["win32", "linux", "darwin"] as const) {
      assert.deepEqual(checkLocalPathSyntax("", platform), { ok: false, reason: "invalid" });
      assert.deepEqual(checkLocalPathSyntax("task\0.json", platform), { ok: false, reason: "invalid" });
    }
  });

  test("POSIX: device files are rejected, backslashes are ordinary characters", () => {
    assert.deepEqual(checkLocalPathSyntax("/dev/zero", "linux"), { ok: false, reason: "device" });
    assert.deepEqual(checkLocalPathSyntax("/dev/stdin", "darwin"), { ok: false, reason: "device" });
    assert.deepEqual(checkLocalPathSyntax("/home/u/task.json", "linux"), { ok: true });
    assert.deepEqual(checkLocalPathSyntax("\\\\server\\share", "linux"), { ok: true });
    assert.deepEqual(checkLocalPathSyntax("NUL", "linux"), { ok: true });
  });
});

describe("S-1 locateInWorkspace (real paths)", () => {
  let base: string;
  let root: string;
  let outside: string;

  before(() => {
    base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-sec-")));
    root = path.join(base, "workspace-root");
    outside = path.join(base, "outside");
    fs.mkdirSync(path.join(root, "cfg"), { recursive: true });
    fs.mkdirSync(path.join(base, "workspace-root-sibling"));
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(root, "codaryn.json"), "{}");
    fs.writeFileSync(path.join(root, "cfg", ".env"), "X=1\n");
    fs.writeFileSync(path.join(outside, "codaryn.json"), "{}");
    fs.writeFileSync(path.join(base, "workspace-root-sibling", "codaryn.json"), "{}");
  });

  after(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  test("files inside the workspace are inside, including ones that do not exist yet", async () => {
    assert.equal(await locateInWorkspace(path.join(root, "codaryn.json"), root), "inside");
    assert.equal(await locateInWorkspace(path.join(root, "cfg", ".env"), root), "inside");
    assert.equal(await locateInWorkspace(path.join(root, "cfg", "missing", "task.json"), root), "inside");
    assert.equal(await locateInWorkspace(root, root), "inside");
  });

  test("files outside, including a sibling that shares the name prefix, are outside", async () => {
    assert.equal(await locateInWorkspace(path.join(outside, "codaryn.json"), root), "outside");
    assert.equal(await locateInWorkspace(path.join(base, "workspace-root-sibling", "codaryn.json"), root), "outside");
    assert.equal(await locateInWorkspace(path.join(outside, "missing.json"), root), "outside");
  });

  test("ignores case on Windows", { skip: !IS_WINDOWS }, async () => {
    assert.equal(await locateInWorkspace(path.join(root.toUpperCase(), "CODARYN.JSON"), root), "inside");
    assert.equal(await locateInWorkspace(path.join(root, "codaryn.json"), root.toUpperCase()), "inside");
  });

  test("a link outside the workspace that points into it is inside", async (t) => {
    const link = path.join(outside, "link-to-workspace");
    try {
      fs.symlinkSync(root, link, "junction");
    } catch {
      t.skip("cannot create a directory link on this system");
      return;
    }
    assert.equal(await locateInWorkspace(path.join(link, "codaryn.json"), root), "inside");
    // The workspace itself named through the link is the same place.
    assert.equal(await locateInWorkspace(path.join(root, "codaryn.json"), link), "inside");
  });

  test("a link inside the workspace that points outside leads outside", async (t) => {
    const link = path.join(root, "link-out");
    try {
      fs.symlinkSync(outside, link, "junction");
    } catch {
      t.skip("cannot create a directory link on this system");
      return;
    }
    assert.equal(await locateInWorkspace(path.join(link, "codaryn.json"), root), "outside");
  });

  test("an 8.3 short name of the workspace is inside", { skip: !IS_WINDOWS }, async (t) => {
    const short = path.join(base, "WORKSP~1");
    if (!fs.existsSync(short)) {
      t.skip("8.3 short names are not generated on this volume");
      return;
    }
    assert.equal(await locateInWorkspace(path.join(short, "codaryn.json"), root), "inside");
  });

  test("anything that cannot be decided is unknown, never outside", async (t) => {
    assert.equal(await locateInWorkspace(path.join(root, "codaryn.json"), path.join(base, "no-such-root")), "unknown");
    const failing: RealpathFs = {
      realpath: async () => {
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      },
      lstat: async () => ({}),
    };
    assert.equal(await locateInWorkspace(path.join(root, "codaryn.json"), root, failing), "unknown");
    assert.equal(await locateInWorkspace("", root), "unknown");

    const dangling = path.join(root, "dangling");
    try {
      fs.symlinkSync(path.join(base, "gone"), dangling, "junction");
    } catch {
      t.diagnostic("dangling link case not covered: cannot create a directory link");
      return;
    }
    assert.equal(await locateInWorkspace(path.join(dangling, "codaryn.json"), root), "unknown");
  });
});

describe("T-14 an alternate data stream of the workspace root is inside (policy review L3)", () => {
  test("root:stream is inside whether or not the stream exists", { skip: !IS_WINDOWS }, async () => {
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "codaryn-ads-")));
    try {
      const root = path.join(base, "ws");
      fs.mkdirSync(root);
      fs.mkdirSync(path.join(base, "ws-other"));
      assert.equal(await locateInWorkspace(`${root}:cfg`, root), "inside");
      try {
        fs.writeFileSync(`${root}:cfg`, "{}");
      } catch {
        // Some volumes refuse streams on directories; the missing-stream case above still ran.
      }
      assert.equal(await locateInWorkspace(`${root}:cfg`, root), "inside");
      assert.equal(await locateInWorkspace(`${root}:cfg:$DATA`, root), "inside");
      // A sibling that only shares the name prefix stays outside.
      assert.equal(await locateInWorkspace(path.join(base, "ws-other:cfg"), root), "outside");
      assert.equal(await locateInWorkspace(`${path.join(base, "ws-other")}:cfg`, root), "outside");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
