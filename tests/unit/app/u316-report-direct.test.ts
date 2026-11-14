/** U-316: app report equivalence against the unchanged CLI adapter. Scripted/local only. */
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppEnvironment, ReportRequest } from "../../../src/app/index.js";
import { copyEnvironment } from "../../../src/app/environment.js";
import { appError, fromCliError, INTERNAL_ERROR } from "../../../src/app/errors.js";
import { runReport } from "../../../src/cli/report.js";
import { listRuns } from "../../../src/store/index.js";
import { appEnvironment, plannedRun, setupRun, taskForm, taskRequest, WRITE_NOTES } from "./support.js";

async function finished() {
  // Generate the records without registering any of the later, synthetic report keys.
  const text = 'u316-current-one u316-current-two u316-control-tab\tkey-value ' + 'u316-prefix-\uac00 emoji \ud83d\ude80 quote " slash \\';
  const base = await setupRun({}, { privacy: { secretEnv: [] } }, [
    { toolCalls: [{ name: "read_file", args: { path: "missing.txt" } }] }, WRITE_NOTES, { text },
  ]);
  const env = await appEnvironment(base, { env: {} });
  const app = createCodarynApp(env);
  const started = await app.startRun(taskRequest(base));
  assert.ok(started.ok);
  const ended = await started.handle.done;
  assert.ok(ended.ok);
  return { base, env, workspace: path.join(base, "work"), runId: started.handle.runId };
}

async function snapshot(root: string): Promise<unknown> {
  const entries = await readdir(root, { withFileTypes: true });
  return Promise.all(entries.sort((a, b) => a.name.localeCompare(b.name)).map(async (entry) => [
    entry.name, entry.isDirectory() ? await snapshot(path.join(root, entry.name)) : (await readFile(path.join(root, entry.name))).toString("hex"),
  ]));
}

async function equivalent(environment: AppEnvironment, request: ReportRequest) {
  const app = createCodarynApp(environment);
  const structured = await app.report(request);
  const markdown = await app.reportMarkdown(request);
  for (const json of [true, false]) {
    let expected: unknown;
    if (!json && (request.workspace.startsWith("-") || request.runId.startsWith("-"))) {
      expected = { ok: false, error: appError("invalid_arguments", "the workspace and the run id cannot start with '-'") };
    } else {
      try {
        const old = await runReport({
          argv: ["report", "--workspace", request.workspace, "--run", request.runId, ...(json ? ["--json"] : [])],
          cwd: environment.cwd, env: copyEnvironment(environment.env, environment.platform),
          platform: environment.platform, listRuns,
        });
        if ("output" in old) {
          assert.equal(old.output.kind, "error");
          expected = { ok: false, error: old.output.kind === "error" ? fromCliError(old.output) : INTERNAL_ERROR };
        } else if (json) {
          const value = JSON.parse(old.text);
          expected = value?.kind === "report" ? { ok: true, output: value } : { ok: false, error: INTERNAL_ERROR };
        } else {
          expected = { ok: true, output: { kind: "report_markdown", markdown: old.text, exitCode: old.exitCode } };
        }
      } catch { expected = { ok: false, error: INTERNAL_ERROR }; }
    }
    const actual = json ? structured : markdown;
    assert.deepEqual(actual, expected);
    assert.equal(JSON.stringify(actual), JSON.stringify(expected), "field order and exact text also agree");
  }
  if (markdown.ok) assert.ok(markdown.output.markdown.endsWith("\n"));
  return { structured, markdown };
}

test("U-316: complete/latest reports preserve exact JSON/Markdown and both masking stages without writes", async () => {
  const f = await finished();
  const before = await snapshot(f.workspace);
  const values = {
    one: "u316-" + "current-one",
    two: "u316-" + "current-two",
    escaped: "u316-" + "prefix-\\uac00",
    syntax: '"schema' + 'Version":1',
  };
  const environments = [
    {},
    { ANTHROPIC_API_KEY: values.one, OPENAI_API_KEY: values.two, GEMINI_API_KEY: "u316-control-tab\tkey-value" },
    { ANTHROPIC_API_KEY: values.escaped }, // only matches after jsonLine's ASCII escaping
    { ANTHROPIC_API_KEY: values.syntax }, // only the whole-text pass matches JSON syntax
  ];
  for (const env of environments) {
    const out = await equivalent({ ...f.env, env }, { workspace: f.workspace, runId: "latest" });
    if (env.ANTHROPIC_API_KEY === '"schemaVersion":1') {
      assert.ok(!out.structured.ok && out.structured.error.code === "internal_error");
    } else assert.ok(out.structured.ok);
    if (env.ANTHROPIC_API_KEY === "u316-prefix-\\uac00") assert.equal(JSON.stringify(out.structured).includes("u316-prefix-"), false);
    if (env.OPENAI_API_KEY) {
      assert.equal(JSON.stringify(out).includes(env.OPENAI_API_KEY), false);
      assert.equal(JSON.stringify(out).includes(env.ANTHROPIC_API_KEY!), false);
    }
  }
  const windows = await equivalent({ ...f.env, platform: "win32", env: { openai_api_key: "u316-current-two" } }, { workspace: f.workspace, runId: f.runId });
  assert.equal(JSON.stringify(windows).includes("u316-current-two"), false);
  assert.deepEqual(await snapshot(f.workspace), before);
});

test("U-316: plan pending/applied hints and apply-run renderer retain exact output and newlines", async () => {
  const f = await plannedRun();
  const env = await appEnvironment(f.base);
  const workspace = path.join(f.base, "work");
  const request = { workspace, runId: f.plan.runId };
  const pending = await equivalent(env, request);
  assert.ok(pending.markdown.ok && pending.markdown.output.markdown.includes("waiting for approval"));
  const started = await f.app.applyPlan({ settings: taskForm(f.base), planRunId: f.plan.runId, digest: f.digest, cancelFile: null, unsafeMoveConsent: null });
  assert.ok(started.ok);
  const ended = await started.handle.done;
  assert.ok(ended.ok);
  const before = await snapshot(workspace);
  const applied = await equivalent(env, request);
  assert.ok(applied.markdown.ok);
  assert.notEqual(applied.markdown.output.markdown, pending.markdown.output.markdown);
  const apply = await equivalent(env, { workspace, runId: started.handle.runId });
  assert.ok(apply.structured.ok && "runKind" in apply.structured.output);
  assert.ok(apply.markdown.ok && apply.markdown.output.markdown.startsWith("# Codaryn apply run report"));
  assert.deepEqual(await snapshot(workspace), before);
});

test("U-316: invalid requests, missing/damaged records, ambiguous latest, and incomplete report agree", async () => {
  const f = await finished();
  for (const request of [
    { workspace: "missing-workspace", runId: "not-a-run" },
    { workspace: f.workspace, runId: "20200101T000000Z-00000000" },
    { workspace: "--json", runId: "latest" },
    { workspace: "-dir", runId: "latest" },
    { workspace: f.workspace, runId: "--json" },
    { workspace: "", runId: "" },
    { workspace: "//127.0.0.1/share", runId: "latest" },
  ]) {
    const out = await equivalent(f.env, request);
    assert.equal(out.structured.ok, false);
  }
  const runs = path.join(f.workspace, ".codaryn/runs");
  await mkdir(path.join(runs, "latest"));
  const ambiguous = await equivalent(f.env, { workspace: f.workspace, runId: "latest" });
  assert.equal(ambiguous.structured.ok, false);
  await rm(path.join(runs, "latest"), { recursive: true });
  const resultFile = path.join(runs, f.runId, "result.json");
  const saved = await readFile(resultFile, "utf8");
  await rm(resultFile);
  const incomplete = await equivalent(f.env, { workspace: f.workspace, runId: f.runId });
  assert.ok(incomplete.structured.ok);
  await writeFile(resultFile, "{broken", "utf8");
  const broken = await equivalent(f.env, { workspace: f.workspace, runId: f.runId });
  assert.ok(!broken.structured.ok && broken.structured.error.code === "invalid_run_record");
  await writeFile(resultFile, saved, "utf8");
});

test("U-316: environment-copy failure precedes parsing except Markdown's leading-dash guard", async () => {
  const f = await finished();
  let reads = 0;
  const env = Object.defineProperty({}, "U316_THROW", { enumerable: true, get() { reads++; throw new Error("synthetic copy failure"); } });
  const app = createCodarynApp({ ...f.env, env });
  reads = 0;
  assert.deepEqual(await app.reportMarkdown({ workspace: "-dir", runId: "latest" }), { ok: false, error: appError("invalid_arguments", "the workspace and the run id cannot start with '-'") });
  assert.equal(reads, 0);
  assert.deepEqual(await app.report({ workspace: "-dir", runId: "latest" }), { ok: false, error: INTERNAL_ERROR });
  assert.equal(reads, 1);
  assert.deepEqual(await app.reportMarkdown({ workspace: f.workspace, runId: "not-a-run" }), { ok: false, error: INTERNAL_ERROR });
  assert.equal(reads, 2);
});
