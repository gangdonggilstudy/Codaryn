/**
 * N-E E-4, E-5 and review R-3 (docs/cli-contract.md 17.2, 17.4 to 17.6): the message language
 * (N-4), human text on stderr with --quiet (N-5), input diagnostics that name positions but no
 * values (N-15), ASCII-only JSON lines (N-19), and a verifier id that people never see (N-24 a).
 * Scripted model, no key, every command behind the network guard.
 */

import assert from "node:assert/strict";
import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { CODARYN_LANG_ENV } from "../../src/contracts/index.js";
import { createSandbox, writeTask, writeWorkspaceFile } from "../fixtures/builders.js";
import type { Sandbox } from "../fixtures/builders.js";
import { SYNTHETIC_MARK, SYNTHETIC_VERIFIER_ID, SYNTHETIC_VERIFIER_ID_SPACED } from "../fixtures/review-inputs.js";
import { REPO_ROOT, cliEnv, expectCliError, expectRunResult } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";
import { expectReportOutput } from "../support/commands.js";
import { runGuarded } from "../support/fake-anthropic.js";
import { AGENT_WORDS_PREFIX, assertHumanError, assertQuiet, withoutAgentWords } from "../support/progress.js";
import { assertNotPrinted } from "../support/usability.js";

const HANGUL = /[가-힣]/;

function cli(sb: Sandbox, args: readonly string[], lang?: string): Promise<CliRun> {
  return runGuarded(sb, args, cliEnv({ extra: lang === undefined ? {} : { [CODARYN_LANG_ENV]: lang } }));
}

/** The demo copied out of the repository; returns its task path. */
function demo(sb: Sandbox): string {
  const dir = join(sb.base, "demo");
  cpSync(join(REPO_ROOT, "examples", "demo"), dir, { recursive: true });
  return join(dir, "task.json");
}

function writeJson(sb: Sandbox, name: string, text: string): string {
  const path = join(sb.base, name);
  writeFileSync(path, text);
  return path;
}

test("N-E E-4 언어: 같은 오류의 stdout은 같고 stderr만 바뀐다, 고르는 순서, 코드는 영어", { timeout: 120_000 }, async (t) => {
  await t.test("CODARYN_LANG ko·en: stdout 바이트가 같고, ko만 한글을 쓰며 둘 다 코드를 괄호에 둔다", async (st) => {
    const sb = createSandbox(st);
    const task = demo(sb);
    const config = writeJson(sb, "syntax.json", '{\n  "schemaVersion": 1,\n  "limits": {\n    "maxModelTurns": 3,,\n  }\n}\n');
    const ko = await cli(sb, ["run", "--task", task, "--config", config], "ko");
    const en = await cli(sb, ["run", "--task", task, "--config", config], "en");
    expectCliError(ko, "invalid_config");
    assert.equal(ko.stdout, en.stdout, "the JSON line does not depend on the language");
    assert.ok(HANGUL.test(ko.stderr), "ko explains in Korean");
    assert.ok(!HANGUL.test(en.stderr), "en has no Hangul");
    assertHumanError(ko, "invalid_config", [sb.base]);
    assertHumanError(en, "invalid_config", [sb.base]);
  });

  await t.test("순서: 유효한 CODARYN_LANG(대소문자 무시) > 설정 language > (무효한 값은 무시)", async (st) => {
    const sb = createSandbox(st);
    const task = demo(sb);
    const config = writeJson(sb, "ko.json", JSON.stringify({ schemaVersion: 1, language: "ko" }));
    const fromConfig = await cli(sb, ["run", "--task", task, "--config", config], "xx");
    expectRunResult(fromConfig);
    assert.ok(HANGUL.test(fromConfig.stderr), "an invalid CODARYN_LANG is ignored and the config's ko applies");
    assert.ok(fromConfig.stderr.includes("(read_file)"), "internal codes stay English in parentheses");
    const fromEnv = await cli(sb, ["run", "--task", task, "--config", config], "EN");
    expectRunResult(fromEnv);
    // DR-47 (U-21): the end summary quotes the agent's last message, which the demo's script wrote
    // in Korean; those rows are the model's words, not the message language.
    assert.ok(fromEnv.stderr.includes(AGENT_WORDS_PREFIX), "the agent's last message is quoted");
    assert.ok(!HANGUL.test(withoutAgentWords(fromEnv.stderr).replace(/summary\.md|notes\.md/g, "")), "CODARYN_LANG wins over the config");
  });

  await t.test("설정 language가 ko·en 밖이면 invalid_config, 값은 출력하지 않는다", async (st) => {
    const sb = createSandbox(st);
    const canary = "cdyLangCanaryValue";
    const config = writeJson(sb, "bad-language.json", JSON.stringify({ schemaVersion: 1, language: canary }));
    const run = await cli(sb, ["run", "--task", demo(sb), "--config", config]);
    const output = expectCliError(run, "invalid_config");
    assert.equal(output.diagnostic?.field, "language");
    assertNotPrinted(run, [canary], "the invalid value");
  });
});

test("N-E E-5 사람용 출력: 진단은 위치만, --quiet, ASCII JSON", { timeout: 120_000 }, async (t) => {
  await t.test("JSON 문법 오류는 줄·열을 알리고, 모르는 필드는 이름을 내지 않는다(N-15)", async (st) => {
    const sb = createSandbox(st);
    const task = demo(sb);
    const syntax = writeJson(sb, "syntax.json", '{\n  "schemaVersion": 1,\n  "limits": {\n    "maxModelTurns": 3,,\n  }\n}\n');
    const bad = expectCliError(await cli(sb, ["run", "--task", task, "--config", syntax]), "invalid_config");
    assert.deepEqual([bad.diagnostic?.code, bad.diagnostic?.file, bad.diagnostic?.line, bad.diagnostic?.column], ["json_syntax", "config", 4, 24]);
    const canary = "cdyUnknownFieldCanary";
    const unknown = writeJson(sb, "unknown.json", JSON.stringify({ schemaVersion: 1, [canary]: true }));
    const run = await cli(sb, ["run", "--task", task, "--config", unknown]);
    expectCliError(run, "invalid_config");
    assertNotPrinted(run, [canary], "the unknown field name");
  });

  await t.test("--quiet: stderr는 비고 stdout은 같은 결과", async (st) => {
    const sb = createSandbox(st);
    const task = demo(sb);
    const quiet = await cli(sb, ["run", "--task", task, "--quiet"]);
    assertQuiet(quiet);
    assert.equal(expectRunResult(quiet).status, "done");
  });

  await t.test("stdout JSON 한 줄은 ASCII뿐이고, 읽으면 한글 값이 그대로다(N-19)", async (st) => {
    const sb = createSandbox(st);
    const run = await cli(sb, ["run", "--task", demo(sb)]);
    assert.ok([...run.stdout].every((char) => char.charCodeAt(0) < 0x80), "stdout has only ASCII characters");
    const result = expectRunResult(run);
    assert.ok(result.verifiers[0]?.evidence.includes("## 결정 사항"), "the escaped Korean reads back as it was");
  });
});

/** A scripted run whose only verifier has the given id and passes. */
async function runWithVerifierId(t: TestContext, id: string, lang: string): Promise<{ readonly sb: Sandbox; readonly run: CliRun; readonly runId: string }> {
  const sb = createSandbox(t);
  writeWorkspaceFile(sb, "README.md", "# 연습\n");
  const task = writeTask(sb, { id: "r3-verifier-id", verifiers: [{ id, kind: "file_rules", rules: [{ type: "exists", path: "README.md" }] }] }, [{ text: "끝" }]);
  const run = await cli(sb, ["run", "--task", task], lang);
  return { sb, run, runId: expectRunResult(run).runId };
}

test("R-3 검증기 id는 진행 줄·끝 요약·Markdown 보고서에 나오지 않고 --json에만 남는다(N-24 (a))", { timeout: 120_000 }, async (t) => {
  for (const id of [SYNTHETIC_VERIFIER_ID, SYNTHETIC_VERIFIER_ID_SPACED]) {
    for (const lang of ["en", "ko"]) {
      await t.test(`${JSON.stringify(id)} (${lang})`, async (st) => {
        const { sb, run, runId } = await runWithVerifierId(st, id, lang);
        assert.ok(run.stderr.length > 0, "the run printed progress and a summary");
        assert.ok(!run.stderr.includes(SYNTHETIC_MARK), `stderr must not show the verifier id: ${JSON.stringify(run.stderr.slice(0, 400))}`);
        const markdown = await cli(sb, ["report", "--workspace", sb.workspace, "--run", runId], lang);
        assert.equal(markdown.exitCode, 0);
        assert.ok(!markdown.stdout.includes(SYNTHETIC_MARK), "the Markdown report must not show the verifier id");
        const json = expectReportOutput(await cli(sb, ["report", "--workspace", sb.workspace, "--run", runId, "--json"], lang), runId);
        assert.deepEqual(json.journal.lastRound.map((verifier) => verifier.id), [id], "--json keeps the id");
      });
    }
  }
});
