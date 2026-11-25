/** Windows taskkill failure: real owned children, fs cleanup, and taskkill-only spawn stand-ins. */
import assert from "node:assert/strict";
import cp from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { createCommandRunner } from "../../../src/tools/index.js";

type Mode = "real" | "exit" | "close" | "error" | "throw" | "late-exit" | "late-error" | "success";
const alive = (child: ChildProcess) => child.exitCode === null && child.signalCode === null;

async function exercise(t: TestContext, mode: Mode, cancel: boolean) {
  const base = await fs.realpath(tmpdir()), root = await fs.realpath(await fs.mkdtemp(path.join(base, "codaryn-taskkill-")));
  const inside = path.relative(base, root); assert.ok(inside && !inside.startsWith("..") && !path.isAbsolute(inside));
  const work = path.join(root, "work"); await fs.mkdir(work);
  const script = path.join(root, "child.cjs");
  // Every child has its own bounded lifetime as well as handle-based test cleanup. No arbitrary PID is used.
  await fs.writeFile(script, `process.stdout.write("ready");setInterval(()=>{},1000);setTimeout(()=>process.exit(0),${mode.startsWith("late") ? 800 : 20000});\n`);
  const spawn = cp.spawn; let child: ChildProcess | undefined, killCalls = 0, killerCode: number | null | undefined;
  let ended: Promise<void> | undefined, directKill: ChildProcess["kill"] | undefined;
  const taskkillDone = Promise.withResolvers<void>(); let stderr = Buffer.alloc(0);
  const ready = Promise.withResolvers<void>();
  t.after(async () => {
    t.mock.restoreAll(); syncBuiltinESMExports();
    if (child && alive(child)) directKill?.();
    await ended;
    assert.equal(await fs.realpath(root), root); assert.equal(path.relative(base, root), inside);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  t.mock.method(cp, "spawn", ((...args: Parameters<typeof cp.spawn>) => {
    const file = String(args[0]);
    if (!file.toLowerCase().endsWith("taskkill.exe")) {
      const owned = spawn(...args); child = owned; directKill = owned.kill.bind(owned);
      ended = new Promise<void>(resolve => owned.once("exit", () => resolve()));
      owned.stdout?.once("data", () => ready.resolve());
      t.mock.method(owned, "kill", (...killArgs: Parameters<ChildProcess["kill"]>) => { killCalls++; return directKill!(...killArgs); });
      return owned;
    }
    assert.ok(child?.pid); assert.deepEqual(args[1], ["/PID", String(child.pid), "/T", "/F"]);
    if (mode === "real") {
      const killer = spawn(args[0], args[1] as string[], { ...args[2], stdio: ["ignore", "pipe", "pipe"] });
      killer.stderr?.on("data", (b: Buffer) => { stderr = Buffer.concat([stderr, b]); });
      killer.once("close", code => { killerCode = code; taskkillDone.resolve(); });
      return killer;
    }
    if (mode === "throw") { taskkillDone.resolve(); throw Object.assign(new Error("synthetic taskkill spawn failure"), { code: "ENOENT" }); }
    const killer = new EventEmitter();
    const emit = () => {
      if (mode === "error" || mode === "late-error") killer.emit("error", Object.assign(new Error("synthetic taskkill error"), { code: "EACCES" }));
      else if (mode !== "close") killer.emit("exit", mode === "success" ? 0 : 1);
      killerCode = mode === "success" ? 0 : 1;
      killer.emit("close", killerCode); taskkillDone.resolve();
    };
    if (mode.startsWith("late")) child.once("exit", emit);
    else setImmediate(() => { if (mode === "success" && child && alive(child)) directKill!(); emit(); });
    return killer as ChildProcess;
  }) as typeof cp.spawn);
  syncBuiltinESMExports();
  const controller = new AbortController();
  const runner = createCommandRunner({ platform: "win32", parentEnv: { SystemRoot: "C:/Windows", PATH: path.dirname(process.execPath) } });
  const pending = runner.run({ executable: process.execPath, args: [script], cwdAbsolute: work, timeoutMs: cancel ? 10000 : 400 }, controller.signal);
  if (cancel) { await ready.promise; controller.abort(); }
  const result = await pending; await taskkillDone.promise;
  assert.ok(child); const childEnded = !alive(child);
  const removable = await fs.rmdir(work).then(() => true, () => false);
  t.diagnostic(JSON.stringify({ mode, cancel, killerCode, taskkillError: new TextDecoder("euc-kr").decode(stderr), childEnded, removable, killCalls, result }));
  assert.equal(childEnded, true, "the direct child must have ended before the runner returns");
  assert.equal(removable, true, "the child's temporary working directory must be removable");
  assert.deepEqual(result, { exitCode: null, stdout: "", stderr: "", timedOut: !cancel, truncated: false });
  if (mode.startsWith("late") || mode === "success") assert.equal(killCalls, 0, "an ended child/successful taskkill must not receive a fallback signal");
  else if (mode !== "real" || killerCode !== 0) assert.equal(killCalls, 1, "error/exit/close must use one guarded fallback at most");
}

for (const cancel of [false, true]) test(`taskkill real ${cancel ? "cancel" : "timeout"}: child ends and cwd can be removed`, { skip: process.platform !== "win32", timeout: 30000 }, t => exercise(t, "real", cancel));
for (const mode of ["exit", "close", "error", "throw", "late-exit", "late-error", "success"] as const) test(`taskkill ${mode}: bounded fallback preserves T-2 and stop result`, { skip: process.platform !== "win32", timeout: 30000 }, t => exercise(t, mode, mode === "close"));
