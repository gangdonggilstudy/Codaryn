/** U-321: real CLI and public app cleanup refuse prepared metadata links. No API or network. */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { link, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { createCodarynApp } from "../../src/app/index.js";
import { createJournal, journalRelativePath, writeResult } from "../../src/store/index.js";
import type { EngineResult, JournalEvent } from "../../src/contracts/index.js";
import { appEnvironment } from "../unit/app/support.js";
import { cliEnv, startCli } from "../support/cli.js";

const RUN = "20260101T010000Z-00000321";
async function fixture(t: TestContext, kind: "junction" | "hardlink" | "normal") {
  const base = await realpath(await mkdtemp(join(tmpdir(), "codaryn-u321-cli-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, "work"), outside = join(base, "outside"), state = join(root, ".codaryn");
  await mkdir(root); await mkdir(outside); await writeFile(join(outside, "sentinel"), "SYNTHETIC ORIGINAL\n");
  if (kind === "junction") await symlink(outside, state, process.platform === "win32" ? "junction" : "dir");
  else {
    const usage = { modelTurns: 1, toolCalls: 0, inputTokens: null, outputTokens: null, durationMs: 1 };
    const journal = createJournal({ workspaceRoot: root, runId: RUN, clock: { now: () => Date.UTC(2026, 0, 1) } });
    await journal.append({ type: "run_started", schemaVersion: 1, taskId: "t", workflow: "document", provider: "scripted", limits: { maxModelTurns: 4, maxToolCalls: 4, maxTotalTokens: null, maxDurationMs: 60000 } } as unknown as JournalEvent);
    await journal.append({ type: "run_finished", status: "done", reason: "verified", usage }); await journal.close();
    await writeResult(root, { schemaVersion: 1, kind: "run", runId: RUN, taskId: "t", status: "done", reason: "verified", exitCode: 0, provider: "scripted", verifiers: [], changes: [], usage, journalPath: journalRelativePath(RUN), notices: [] } as EngineResult);
    if (kind === "hardlink") await link(join(outside, "sentinel"), join(state, "cleanup.jsonl"));
  }
  return { base, root, outside, state };
}
async function outsideUnchanged(outside: string) {
  assert.equal(await readFile(join(outside, "sentinel"), "utf8"), "SYNTHETIC ORIGINAL\n");
  assert.deepEqual(await readdir(outside), ["sentinel"]);
}
for (const kind of ["junction", "hardlink", "normal"] as const) {
  for (const language of ["en", "ko"] as const) {
    test(`U321 CLI ${language}: ${kind}, preview then confirm; outside unchanged`, { timeout: 30000 }, async (t) => {
      const f = await fixture(t, kind);
      const args = ["cleanup", "--workspace", f.root, ...(kind === "junction" ? [] : ["--run", RUN])];
      const run = (extra: string[]) => startCli([...args, ...extra], { cwd: f.base, env: cliEnv({ extra: { CODARYN_LANG: language } }), timeoutMs: 15000 }).done;
      const preview = await run(["--json"]); assert.equal(preview.exitCode, 0);
      const plan = JSON.parse(preview.stdout).plan as { digest: string };
      if (kind !== "normal") {
        const stale = await run(["--confirm", "0".repeat(64), "--json"]);
        assert.equal(JSON.parse(stale.stdout).code, "cleanup_plan_changed");
      }
      const applied = await run(["--confirm", plan.digest, "--include-not-reverted", "--json"]);
      const output = JSON.parse(applied.stdout) as { code?: string; status?: string };
      if (kind === "normal") { assert.equal(applied.exitCode, 0); assert.equal(output.status, "removed"); }
      else {
        assert.equal(applied.exitCode, 70); assert.equal(output.code, "internal_error");
        assert.equal((applied.stdout + applied.stderr).includes(f.outside), false);
        if (kind === "hardlink") assert.ok(existsSync(join(f.state, "runs", RUN)));
      }
      assert.equal(existsSync(join(f.state, "lock.json")), false); await outsideUnchanged(f.outside);
    });
  }
  test(`U321 public app: ${kind}, existing error mapping and outside unchanged`, async (t) => {
    const f = await fixture(t, kind), selection = kind === "junction" ? {} : { runs: { runIds: [RUN] } };
    const app = createCodarynApp(await appEnvironment(f.base));
    const preview = await app.previewCleanup({ workspace: f.root, selection }); assert.ok(preview.ok);
    const applied = await app.applyCleanup({ workspace: f.root, selection, now: preview.output.now, confirmation: { digest: preview.output.plan.digest, discarded: false, includeNotReverted: true } });
    if (kind === "normal") { assert.ok(applied.ok); assert.equal(applied.output.status, "removed"); }
    else { assert.equal(applied.ok, false); if (!applied.ok) assert.equal(applied.error.code, "internal_error"); if (kind === "hardlink") assert.ok(existsSync(join(f.state, "runs", RUN))); }
    assert.equal(existsSync(join(f.state, "lock.json")), false); await outsideUnchanged(f.outside);
  });
}
