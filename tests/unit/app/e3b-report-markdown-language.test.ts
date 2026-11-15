import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createCodarynApp } from "../../../src/app/index.js";
import { runReport } from "../../../src/cli/report.js";
import { listRuns } from "../../../src/store/index.js";
import { appEnvironment, plannedRun, setupRun, taskForm, taskRequest, WRITE_NOTES } from "./support.js";

test("DR-77 app: request language alone controls Markdown; structured data and records are identical", async () => {
  const base = await setupRun({}, {}, [WRITE_NOTES, { text: "original model words" }]);
  const defaults = await appEnvironment(base);
  const environment = { ...defaults, env: { ...defaults.env, CODARYN_LANG: "ko" } };
  const app = createCodarynApp(environment), started = await app.startRun(taskRequest(base)); assert.ok(started.ok);
  assert.ok((await started.handle.done).ok);
  const request = { workspace: path.join(base, "work"), runId: started.handle.runId };
  const paths = ["result.json", "journal.jsonl"].map(name => path.join(request.workspace, ".codaryn/runs", request.runId, name));
  const before = await Promise.all(paths.map(file => readFile(file)));
  const omitted = await app.reportMarkdown(request), en = await app.reportMarkdown({ ...request, language: "en" }), ko = await app.reportMarkdown({ ...request, language: "ko" });
  assert.deepEqual(omitted, en); assert.ok(en.ok && ko.ok);
  const old = await runReport({ argv: ["report", "--workspace", request.workspace, "--run", request.runId], cwd: base, env: {}, listRuns });
  assert.ok("text" in old); assert.equal(en.output.markdown, old.text); assert.equal(ko.output.exitCode, en.output.exitCode);
  assert.ok(ko.output.markdown.startsWith("# Codaryn 실행 보고서\n")); assert.ok(ko.output.markdown.includes("original model words"));
  const structured = await app.report(request); assert.ok(structured.ok);
  assert.deepEqual(await app.report({ ...request, language: "ko" }), structured);
  assert.deepEqual(await Promise.all(paths.map(file => readFile(file))), before);
});

test("DR-77 app: pending plans and actual apply-run reports use the requested language", async () => {
  const f = await plannedRun(), workspace = path.join(f.base, "work");
  const pending = await f.app.reportMarkdown({ workspace, runId: f.plan.runId, language: "ko" });
  assert.ok(pending.ok); assert.ok(pending.output.markdown.includes("승인을 기다립니다"));
  const started = await f.app.applyPlan({ settings: taskForm(f.base), planRunId: f.plan.runId, digest: f.digest, cancelFile: null, unsafeMoveConsent: null });
  assert.ok(started.ok); assert.ok((await started.handle.done).ok);
  const request = { workspace, runId: started.handle.runId };
  const en = await f.app.reportMarkdown({ ...request, language: "en" }), ko = await f.app.reportMarkdown({ ...request, language: "ko" });
  assert.ok(en.ok && ko.ok); assert.deepEqual(await f.app.reportMarkdown(request), en);
  assert.ok(en.output.markdown.startsWith("# Codaryn apply run report\n")); assert.ok(ko.output.markdown.startsWith("# Codaryn 적용 실행 보고서\n"));
  assert.equal(ko.output.exitCode, en.output.exitCode);
});
