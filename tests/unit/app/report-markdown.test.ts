/**
 * GU-3 (standalone-gui 3.7, "보고서 저장"): the app layer gives the report as `codaryn report`
 * prints it without `--json` (Markdown, keys hidden), for the main process to save where the person
 * chose. The window keeps showing the structured `report`. Fake values only.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { runReport } from "../../../src/cli/report.js";
import { listRuns } from "../../../src/store/index.js";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, ReportMarkdown } from "../../../src/app/index.js";
import { FAKE_SECRET, WRITE_NOTES, appEnvironment, setupRun, taskRequest } from "./support.js";

function ok(outcome: AppCallOutcome<ReportMarkdown>): ReportMarkdown {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { output: ReportMarkdown }).output;
}

const code = (outcome: AppCallOutcome<unknown>): string | null => (outcome.ok ? null : outcome.error.code);

async function finishedRun(): Promise<{ base: string; workspace: string; runId: string }> {
  const base = await setupRun({ "README.md": `# Title\nkey ${FAKE_SECRET}\n` }, {}, [WRITE_NOTES, { text: "done" }]);
  const started = await createCodarynApp(await appEnvironment(base)).startRun(taskRequest(base));
  assert.ok(started.ok);
  await started.handle.done;
  return { base, workspace: path.join(base, "work"), runId: started.handle.runId };
}

describe("reportMarkdown (GU-3 보고서 저장)", () => {
  test("the text `codaryn report` prints, with the report's exit code", async () => {
    const { base, workspace, runId } = await finishedRun();
    const app = createCodarynApp(await appEnvironment(base));
    const output = ok(await app.reportMarkdown({ workspace, runId }));
    const env = (await appEnvironment(base)).env;
    const printed = await runReport({ argv: ["report", "--workspace", workspace, "--run", runId], cwd: base, env, platform: process.platform, listRuns });
    assert.ok("text" in printed);
    assert.deepEqual(output, { kind: "report_markdown", markdown: printed.text, exitCode: printed.exitCode });
    assert.ok(output.markdown.startsWith("# Codaryn run report"), output.markdown.slice(0, 80));
    assert.ok(output.markdown.includes(runId));
    const structured = await app.report({ workspace, runId });
    assert.ok(structured.ok);
    assert.equal(output.exitCode, structured.output.exitCode);
    assert.equal(output.markdown.includes(FAKE_SECRET), false);
  });

  test("errors are the report's: an unknown run; a flag-like run id or workspace is refused before anything is read", async () => {
    const { base, workspace } = await finishedRun();
    const app = createCodarynApp(await appEnvironment(base));
    assert.equal(code(await app.reportMarkdown({ workspace, runId: "20200101T000000Z-00000000" })), "run_not_found");
    assert.equal(code(await app.reportMarkdown({ workspace, runId: "--json" })), "invalid_arguments");
    assert.equal(code(await app.reportMarkdown({ workspace: "--json", runId: "latest" })), "invalid_arguments");
    // The CLI would look for a folder named "-dir" (workspace_not_found); the app refuses first.
    assert.equal(code(await app.reportMarkdown({ workspace: "-dir", runId: "latest" })), "invalid_arguments");
  });
});
