/** IR-F3: a saved verdict survives an EBUSY lock release, through the real app and CLI. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import { runReview } from "../../../src/cli/plan-commands.js";
import { runGuardedCommand } from "../../../src/cli/guard.js";
import { locateInWorkspace, relateRealPaths } from "../../../src/cli/security/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { releaseLock, writeReviewRecord } from "../../../src/store/index.js";
import type { ReviewOutput } from "../../../src/contracts/index.js";
import { WRITE_NOTES, appEnvironment, exists, runDir, setupRun, taskForm, taskRequest } from "./support.js";

async function fixture() {
  const base = await setupRun({}, { workflowRef: "analyze" }, [WRITE_NOTES, { text: "done" }]);
  const env = await appEnvironment(base), app = createCodarynApp(env), run = await app.startRun(taskRequest(base));
  assert.ok(run.ok); const end = await run.handle.done;
  assert.ok(end.ok && end.result.reason === "awaiting_review");
  const runId = run.handle.runId, dir = runDir(base, runId), file = path.join(dir, "review.json");
  const lock = path.join(base, "work", ".codaryn", "lock.json");
  const before = await fs.readFile(path.join(dir, "result.json"), "utf8");
  return { base, env, app, runId, dir, file, lock, before };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Only deletion of this temporary workspace's lock fails; real retries and record I/O stay. */
function busy(t: TestContext, f: Fixture) {
  const remove = fs.rm; let attempts = 0;
  t.mock.method(fs, "rm", async (...args: Parameters<typeof fs.rm>) => {
    if (path.resolve(String(args[0])) === f.lock) { attempts++; throw Object.assign(new Error("synthetic busy lock"), { code: "EBUSY" }); }
    return remove(...args);
  });
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return () => attempts;
}
const cli = (f: Fixture, decision: "accept" | "reject", json: boolean, language?: "en" | "ko") => ({
  ...f.env, argv: ["review", "--task", "task.json", "--run", f.runId, `--${decision}`, ...(json ? ["--json"] : [])],
  loadEnvFile: () => undefined, locateInWorkspace, relatePaths: relateRealPaths,
  ...(language === undefined ? {} : { messages: createMessageCatalog(language) }),
});
async function state(f: Fixture) {
  return { stored: JSON.parse(await fs.readFile(f.file, "utf8")) as { verdict: string }, left: await exists(f.lock),
    resultUnchanged: await fs.readFile(path.join(f.dir, "result.json"), "utf8") === f.before };
}

for (const decision of ["accept", "reject"] as const) test(`IR-F3 app ${decision}: saved review succeeds with lockLeft after release retries`, async t => {
  const f = await fixture(), attempts = busy(t, f);
  const outcome = await f.app.review({ settings: taskForm(f.base), runId: f.runId, decision, note: null });
  const seen = await state(f); t.diagnostic(JSON.stringify({ path: "app", decision, outcome, seen, attempts: attempts() }));
  assert.equal(seen.stored.verdict, decision === "accept" ? "accepted" : "rejected");
  assert.equal(seen.left, true); assert.equal(seen.resultUnchanged, true); assert.equal(attempts(), 6);
  assert.ok(outcome.ok); const output = outcome.output as ReviewOutput & { lockLeft?: true };
  assert.equal(output.kind, "review"); assert.equal(output.lockLeft, true); assert.equal(output.exitCode, 0);
});

for (const decision of ["accept", "reject"] as const) test(`IR-F3 CLI JSON ${decision}: stored verdict, exit zero and lockLeft`, async t => {
  const f = await fixture(), attempts = busy(t, f);
  const outcome = await runGuardedCommand(() => runReview(cli(f, decision, true)));
  const seen = await state(f); t.diagnostic(JSON.stringify({ path: "cli-json", decision, outcome, seen, attempts: attempts() }));
  assert.equal(seen.stored.verdict, decision === "accept" ? "accepted" : "rejected");
  assert.equal(seen.left, true); assert.equal(seen.resultUnchanged, true);
  assert.equal(outcome.exitCode, 0); assert.ok("output" in outcome && outcome.output.kind === "review");
  assert.equal((outcome.output as ReviewOutput & { lockLeft?: true }).lockLeft, true);
});

for (const language of [undefined, "en", "ko"] as const) test(`IR-F3 CLI text ${language ?? "fallback"}: reuses the U-220 warning once, exit unchanged`, async t => {
  const f = await fixture(); busy(t, f);
  const outcome = await runGuardedCommand(() => runReview(cli(f, "reject", false, language)));
  const line = createMessageCatalog(language ?? "en").format("lock.release_failed"), seen = await state(f);
  t.diagnostic(JSON.stringify({ path: "cli-text", language: language ?? "fallback", exitCode: outcome.exitCode, line, seen }));
  assert.equal(outcome.exitCode, 0); assert.ok("text" in outcome);
  assert.equal(outcome.text.split("\n").filter(part => part === line).length, 1);
  assert.equal(seen.stored.verdict, "rejected"); assert.equal(seen.left, true); assert.equal(seen.resultUnchanged, true);
});

test("IR-F3 normal release: app and CLI keep their exact output shape, text and exit code", async () => {
  const f = await fixture();
  const accepted = await f.app.review({ settings: taskForm(f.base), runId: f.runId, decision: "accept", note: null }); assert.ok(accepted.ok);
  const output = accepted.output;
  assert.deepEqual(Object.keys(output).sort(), ["schemaVersion", "kind", "runId", "verdict", "exitCode", "checklist", "replaced"].sort());
  assert.equal(await exists(f.lock), false); assert.equal(output.replaced, false);
  const json = await runGuardedCommand(() => runReview(cli(f, "reject", true))); assert.ok("output" in json);
  assert.deepEqual(json.output, { ...output, verdict: "rejected", replaced: true }); assert.equal(json.exitCode, 0);
  const text = await runGuardedCommand(() => runReview(cli(f, "accept", false))); assert.ok("text" in text);
  assert.equal(text.text, `Review of run ${f.runId}: accepted (an earlier review was replaced).\n${output.checklist.map((item, i) => `  ${i + 1}. ${item}`).join("\n")}\nThe run's result and records are unchanged; \`codaryn report\` shows the verdict.\n`);
  assert.equal(text.exitCode, 0); assert.equal(await exists(f.lock), false);
});

for (const owner of ["app", "cli"] as const) test(`IR-F3 ${owner}: a pre-save failure remains an error even when release also fails`, async t => {
  const f = await fixture();
  await writeReviewRecord(path.join(f.base, "work"), { schemaVersion: 1, kind: "review_record", runId: f.runId, at: new Date().toISOString(), verdict: "accepted", note: null });
  const before = await fs.readFile(f.file, "utf8"), rename = fs.rename;
  t.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => {
    if (args[1] === f.file) throw Object.assign(new Error("synthetic denied review save"), { code: "EACCES" });
    return rename(...args);
  }); busy(t, f); syncBuiltinESMExports();
  if (owner === "app") {
    const outcome = await f.app.review({ settings: taskForm(f.base), runId: f.runId, decision: "reject", note: null });
    assert.equal(outcome.ok, false); if (!outcome.ok) assert.equal(outcome.error.code, "internal_error");
  } else {
    const outcome = await runGuardedCommand(() => runReview(cli(f, "reject", true)));
    assert.equal(outcome.exitCode, 70); assert.ok("output" in outcome && outcome.output.kind === "error");
  }
  assert.equal(await fs.readFile(f.file, "utf8"), before); assert.equal(await exists(f.lock), true);
});

/** Change only the synthetic lock, after the real review rename; releaseLock itself stays real. */
function displaceLock(t: TestContext, f: Fixture, mode: "other-run" | "unreadable") {
  const rename = fs.rename, remove = fs.rm;
  let originalRunId: string | null = null, changes = 0, removals = 0;
  let replacement = "";
  t.mock.method(fs, "rename", async (...args: Parameters<typeof fs.rename>) => {
    await rename(...args);
    if (path.resolve(String(args[1])) !== f.file) return;
    const held = JSON.parse(await fs.readFile(f.lock, "utf8")) as { runId: string };
    originalRunId = held.runId;
    replacement = `${JSON.stringify(mode === "other-run" ? { ...held, runId: "synthetic-other-review" } : {})}\n`;
    await fs.writeFile(f.lock, replacement, "utf8");
    changes++;
  });
  t.mock.method(fs, "rm", async (...args: Parameters<typeof fs.rm>) => {
    if (path.resolve(String(args[0])) === f.lock) removals++;
    return remove(...args);
  });
  syncBuiltinESMExports(); t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return async () => {
    assert.equal(changes, 1, "the lock changed only after the review was stored");
    assert.ok(originalRunId !== null);
    assert.equal(await fs.readFile(f.lock, "utf8"), replacement, "the changed lock was not removed or rewritten");
    assert.equal(removals, 0, "the real release refused to delete the changed lock");
    assert.equal(await releaseLock({ workspaceRoot: path.join(f.base, "work"), runId: originalRunId }), false);
    assert.equal(await exists(f.lock), true);
  };
}

for (const mode of ["other-run", "unreadable"] as const) {
  for (const channel of ["app", "cli-json", "cli-text"] as const) {
    test(`F3R-1 ${channel} ${mode}: a false release keeps the saved verdict and reports lockLeft`, async t => {
      const f = await fixture(), verifyLock = displaceLock(t, f, mode);
      const language = mode === "other-run" ? "en" : "ko";
      const outcome = channel === "app"
        ? await f.app.review({ settings: taskForm(f.base), runId: f.runId, decision: "accept", note: null })
        : await runGuardedCommand(() => runReview(cli(f, "accept", channel === "cli-json", language)));
      const seen = await state(f);
      await verifyLock();
      assert.equal(seen.stored.verdict, "accepted");
      assert.equal(Object.hasOwn(seen.stored, "lockLeft"), false, "lockLeft belongs to the result, not review.json");
      assert.equal(seen.resultUnchanged, true); assert.equal(seen.left, true);
      t.diagnostic(JSON.stringify({ mode, channel, stored: seen.stored.verdict, recordHasLockLeft: Object.hasOwn(seen.stored, "lockLeft"), lockRemains: seen.left, realRelease: false }));
      if ("text" in outcome) {
        assert.equal(outcome.exitCode, 0);
        const line = createMessageCatalog(language).format("lock.release_failed");
        assert.equal(outcome.text.split("\n").filter(part => part === line).length, 1);
      } else {
        if ("ok" in outcome) assert.ok(outcome.ok);
        assert.ok("output" in outcome && outcome.output.kind === "review");
        assert.equal(outcome.output.exitCode, 0);
        assert.equal((outcome.output as ReviewOutput).lockLeft, true);
      }
    });
  }
}
