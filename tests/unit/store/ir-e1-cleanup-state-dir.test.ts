/**
 * IR-E1 follow-up: cleanup refuses a state directory `.codaryn`, or its `runs`, that is a link or not a
 * plain directory with state_dir_not_plain, in all three steps (summary, preview, confirmed apply) and in
 * the store, the app layer and the CLI (exit 2). Nothing behind the link changes. A missing state
 * directory is still the ordinary empty state, and the summary and preview make nothing for it.
 * Junctions are Windows only; elsewhere the link cases skip.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";

import { createCodarynApp } from "../../../src/app/index.js";
import { runCleanup } from "../../../src/cli/cleanup.js";
import { applyCleanupWith, planCleanup, summarizeState } from "../../../src/store/index.js";
import { appEnvironment } from "../app/support.js";

const OTHER = "20261127T000000Z-0000c1ea";
const NOW = "2026-11-27T01:02:03.000Z";
const SKIP = process.platform === "win32" ? false : "junctions exist on Windows only";
const CONFIRMATION = { digest: "0".repeat(64), discarded: false, includeNotReverted: false };

async function listed(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    out.push(entry.name);
    if (entry.isDirectory()) out.push(...(await listed(join(dir, entry.name))).map((name) => `${entry.name}/${name}`));
  }
  return out;
}

/** base/ws and base/outside holding another run's records; `.codaryn` or `.codaryn/runs` is a junction to it. */
async function layout(t: TestContext, place: "state" | "runs") {
  const base = await realpath(await mkdtemp(join(tmpdir(), "codaryn-e1-cleanup-")));
  t.after(() => rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const root = join(base, "ws"), outside = join(base, "outside");
  await mkdir(root);
  const runs = place === "state" ? join(outside, "runs") : outside;
  await mkdir(join(runs, OTHER), { recursive: true });
  await writeFile(join(runs, OTHER, "result.json"), "{}\n");
  if (place === "state") await symlink(outside, join(root, ".codaryn"), "junction");
  else {
    await mkdir(join(root, ".codaryn"));
    await symlink(outside, join(root, ".codaryn", "runs"), "junction");
  }
  return { base, root, outside, before: await listed(outside) };
}

const codeOf = (outcome: unknown): unknown => {
  const value = outcome as { ok?: boolean; error?: { code?: unknown } };
  return value.ok === false ? value.error?.code : `ok: ${JSON.stringify(outcome).slice(0, 100)}`;
};

for (const place of ["state", "runs"] as const) {
  const where = place === "state" ? ".codaryn" : ".codaryn/runs";

  test(`IR-E1 cleanup store (junction at ${where}): summary and preview reject, the apply answers state_dir_not_plain`, { skip: SKIP }, async (t) => {
    const { root, outside, before } = await layout(t, place);
    await assert.rejects(summarizeState({ workspaceRoot: root }), { code: "state_dir_not_plain" });
    await assert.rejects(planCleanup({ workspaceRoot: root, selection: { runs: { olderThanDays: 0 } }, now: NOW }), { code: "state_dir_not_plain" });
    const applied = await applyCleanupWith({ workspaceRoot: root, selection: { runs: { olderThanDays: 0 } }, now: NOW, confirmation: CONFIRMATION });
    assert.deepEqual(applied, { ok: false, code: "state_dir_not_plain" });
    assert.deepEqual(await listed(outside), before, "nothing behind the link changed");
  });

  test(`IR-E1 cleanup app (junction at ${where}): the summary, the preview and the apply refuse as state_dir_not_plain`, { skip: SKIP }, async (t) => {
    const { base, root, outside, before } = await layout(t, place);
    const app = createCodarynApp(await appEnvironment(base));
    assert.equal(codeOf(await app.stateSummary({ workspace: root })), "state_dir_not_plain");
    const selection = { runs: { olderThanDays: 0 } };
    assert.equal(codeOf(await app.previewCleanup({ workspace: root, selection })), "state_dir_not_plain");
    assert.equal(codeOf(await app.applyCleanup({ workspace: root, selection, now: NOW, confirmation: CONFIRMATION })), "state_dir_not_plain");
    assert.deepEqual(await listed(outside), before);
  });

  test(`IR-E1 cleanup CLI (junction at ${where}): exit 2, state_dir_not_plain`, { skip: SKIP }, async (t) => {
    const { base, outside, before } = await layout(t, place);
    const outcome = await runCleanup({ argv: ["cleanup", "--workspace", "ws", "--json"], cwd: base, env: {}, clock: { now: () => Date.parse(NOW) } });
    assert.ok("output" in outcome, JSON.stringify(outcome).slice(0, 200));
    assert.deepEqual([outcome.exitCode, (outcome.output as { code?: unknown }).code], [2, "state_dir_not_plain"]);
    assert.deepEqual(await listed(outside), before);
  });
}

test("IR-E1 cleanup: a missing state directory is the empty state, and the summary and preview make nothing", async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codaryn-e1-cleanup-")));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const summary = await summarizeState({ workspaceRoot: root });
  assert.equal(summary.runs.count, 0);
  const plan = await planCleanup({ workspaceRoot: root, selection: { runs: { olderThanDays: 0 } }, now: NOW });
  assert.deepEqual(plan.items, []);
  assert.deepEqual(await readdir(root), [], "no .codaryn was made");
});
