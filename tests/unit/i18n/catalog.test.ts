/**
 * N-4 catalog (CreateMessageCatalog): both languages have every MessageId, each template uses
 * exactly its parameters, `format` throws on a wrong id or parameter set, every message is one
 * clean line, and the wording keeps the UX rules.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CLI_ERROR_EXIT_CODES, INPUT_DIAGNOSTIC_FILES, MESSAGE_IDS, RUN_REASONS, TERMINAL_RUN_STATUSES } from "../../../src/contracts/index.js";
import type { MessageId, MessageLanguage } from "../../../src/contracts/index.js";
import { createMessageCatalog, MESSAGE_TEXTS, MessageFormatError, PLACEHOLDER, REPLACEMENT } from "../../../src/i18n/index.js";
import { CONTROL, IDS, LANGS, loose, paramsFor, samples, specOf } from "./support.js";

const HANGUL = /[가-힣]/u;

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

function placeholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1] as string);
}

describe("i18n catalog: completeness", () => {
  test("both languages have exactly the contract's message ids", () => {
    for (const language of LANGS) {
      assert.deepEqual(sorted(Object.keys(MESSAGE_TEXTS[language])), sorted(new Set(MESSAGE_IDS)), language);
    }
    assert.equal(new Set(MESSAGE_IDS).size, MESSAGE_IDS.length);
  });

  test("each template uses every listed parameter once and no other, with no stray braces", () => {
    for (const language of LANGS) {
      for (const id of IDS) {
        const template = MESSAGE_TEXTS[language][id];
        assert.deepEqual(sorted(placeholders(template)), sorted(Object.keys(specOf(id))), `${language} ${id}`);
        assert.ok(!/[{}]/.test(template.replace(PLACEHOLDER, "")), `${language} ${id}: stray brace`);
        assert.ok(template.trim().length > 0, `${language} ${id}: empty`);
      }
    }
  });

  test("listed ids cover every error code, status, reason, advice and diagnostic file", () => {
    const ids = new Set<string>(MESSAGE_IDS);
    for (const code of Object.keys(CLI_ERROR_EXIT_CODES)) assert.ok(ids.has(`error.${code}.what`) && ids.has(`error.${code}.fix`), code);
    for (const status of TERMINAL_RUN_STATUSES) assert.ok(ids.has(`status.${status}`), status);
    for (const reason of RUN_REASONS) assert.ok(ids.has(`reason.${reason}`) && ids.has(`advice.${reason}`), reason);
    for (const file of INPUT_DIAGNOSTIC_FILES) assert.ok(ids.has(`diagnostic.file.${file}`), file);
  });
});

describe("i18n catalog: format", () => {
  test("renders every message in both languages as one non-empty clean line", () => {
    for (const language of LANGS) {
      const catalog = createMessageCatalog(language);
      const format = loose(catalog);
      for (const id of IDS) {
        const line = format(id, paramsFor(catalog, id));
        assert.ok(line.trim().length > 0, `${language} ${id}`);
        assert.ok(!CONTROL.test(line), `${language} ${id}: control character`);
        for (const leftover of ["undefined", "NaN", "[object", "{", "}"]) assert.ok(!line.includes(leftover), `${language} ${id}: ${line}`);
      }
    }
  });

  test("accepts the sample of every kind and uses every parameter", () => {
    for (const language of LANGS) {
      const catalog = createMessageCatalog(language);
      const format = loose(catalog);
      for (const id of IDS) {
        const base = format(id, paramsFor(catalog, id));
        for (const [name, kind] of Object.entries(specOf(id))) {
          const rejected = format(id, paramsFor(catalog, id, { name, value: {} }));
          const other = format(id, paramsFor(catalog, id, { name, value: samples(kind, catalog)[1] }));
          assert.notEqual(base, rejected, `${language} ${id}: sample for ${name} (${kind}) was rejected`);
          assert.notEqual(base, other, `${language} ${id}: parameter ${name} is not used`);
        }
      }
    }
  });

  test("throws for an unknown id, a missing parameter and an extra parameter, without the values", () => {
    const catalog = createMessageCatalog("en");
    const format = loose(catalog);
    const cases: [() => string, RegExp][] = [
      [() => format("probe.unknown" as MessageId, {}), /^unknown message id$/],
      [() => format("__proto__" as MessageId, {}), /^unknown message id$/],
      [() => format("summary.changes", {}), /^message summary\.changes: missing parameter count$/],
      [() => format("summary.changes"), /^message summary\.changes: missing parameter count$/],
      [() => format("summary.changes", { count: 1, probeExtra: "probe-value" }), /^message summary\.changes: unexpected parameter$/],
      [() => format("status.done", { probeExtra: "probe-value" }), /^message status\.done: unexpected parameter$/],
    ];
    for (const [call, message] of cases) {
      assert.throws(call, (error: unknown) => {
        assert.ok(error instanceof MessageFormatError);
        assert.match(error.message, message);
        assert.ok(!error.message.includes("probe-value"));
        return true;
      });
    }
  });

  test("examples in both languages, through the typed format", () => {
    const ko = createMessageCatalog("ko");
    const en = createMessageCatalog("en");
    assert.equal(ko.language, "ko");
    assert.equal(ko.format("error.invalid_config.what"), "설정 파일을 읽을 수 없거나 값이 올바르지 않습니다");
    assert.equal(ko.format("summary.changes", { count: 2 }), "바뀐 파일: 2개");
    assert.equal(en.format("summary.verifiers", { passed: 1, total: 2 }), "Checks passed: 1 of 2 (within the configured checks)");
    assert.equal(
      ko.format("progress.tool_denied", { tool: ko.format("tool.run_command"), permission: "command", code: "command_not_allowed" }),
      "명령 실행 — 거부 (command/command_not_allowed)",
    );
    assert.equal(ko.format("progress.finished", { status: ko.format("status.done"), reason: "verified" }), "끝 — 완료 (verified)");
    assert.equal(
      ko.format("summary.result", { status: ko.format("status.done"), reason: ko.format("reason.verified") }),
      "결과: 완료 — 지정한 검증 모두 통과",
    );
    assert.equal(en.format("init.saved", { location: "%APPDATA%\\Codaryn\\config.json" }), "Saved: %APPDATA%\\Codaryn\\config.json");
    assert.equal(ko.format("progress.verifier", { number: 2, outcome: ko.format("outcome.pass") }), "검증 2번 — 통과");
    assert.equal(
      en.format("summary.next_revert", { runId: "20261112T010203Z-0123abcd" as never }),
      "Revert: codaryn revert --workspace <workspace> --run 20261112T010203Z-0123abcd",
    );
    assert.equal(ko.format("diagnostic.json_syntax", { line: 3, column: 14 }), "JSON 문법 오류: 3줄 14열");
  });

  test("an unknown language falls back to en", () => {
    const catalog = createMessageCatalog("fr" as MessageLanguage);
    assert.equal(catalog.language, "en");
    assert.equal(catalog.format("status.done"), "done");
  });

  test("text takes only what this catalog produced", () => {
    const ko = createMessageCatalog("ko");
    const en = createMessageCatalog("en");
    const format = loose(ko);
    assert.equal(format("summary.result", { status: en.format("status.done"), reason: ko.format("reason.verified") }), `결과: ${REPLACEMENT} — 지정한 검증 모두 통과`);
    assert.equal(format("summary.result", { status: "완료", reason: "probe" }), `결과: ${REPLACEMENT} — ${REPLACEMENT}`);
  });
});

describe("i18n catalog: language and wording", () => {
  test("Korean texts are Korean, English texts have no Hangul", () => {
    for (const id of IDS) {
      assert.match(MESSAGE_TEXTS.ko[id], HANGUL, `ko ${id}`);
      assert.doesNotMatch(MESSAGE_TEXTS.en[id], HANGUL, `en ${id}`);
    }
  });

  test("codes stay English", () => {
    const ko = createMessageCatalog("ko");
    assert.equal(ko.format("progress.model_error", { turn: 3, kind: "auth_failed" }), "3턴 — 모델 호출 오류 (auth_failed)");
    assert.equal(ko.format("progress.integrity_unchanged", { phase: "before_verify" }), "보호 대상 확인 — 바뀌지 않음 (before_verify)");
  });

  test("command hints never repeat a typed path", () => {
    for (const language of LANGS) {
      for (const id of ["summary.next_report", "summary.next_revert"] as const) assert.match(MESSAGE_TEXTS[language][id], /--workspace <workspace> --run \{runId\}$/);
      for (const id of ["summary.next_report_here", "summary.next_revert_here"] as const) assert.match(MESSAGE_TEXTS[language][id], /--workspace \. --run \{runId\}$/);
    }
  });

  test("no text claims protection Codaryn does not give (UX 1.4, M-8)", () => {
    const overclaimKo = ["안전", "샌드박스", "차단", "암호화", "보장"];
    const overclaimEn = [/\bsafe/i, /sandbox/i, /\bblock/i, /encrypt/i, /\bsecure/i, /guarantee/i];
    for (const id of IDS) {
      for (const word of overclaimKo) assert.ok(!MESSAGE_TEXTS.ko[id].includes(word), `ko ${id}: ${word}`);
      for (const word of overclaimEn) assert.doesNotMatch(MESSAGE_TEXTS.en[id], word, `en ${id}`);
    }
  });

  test("yes/no prompts show the default answer as the capital letter (N-20, UX 7)", () => {
    for (const language of LANGS) {
      assert.match(MESSAGE_TEXTS[language]["prompt.yes_no_default_yes"], /\[Y\/n\]/);
      assert.match(MESSAGE_TEXTS[language]["prompt.yes_no_default_no"], /\[y\/N\]/);
    }
    assert.match(MESSAGE_TEXTS.ko["prompt.yes_no_default_no"], /Enter: 아니오/);
  });

  test("help and doctor texts keep option names, check ids' codes and exit codes as they are", () => {
    for (const language of LANGS) {
      assert.match(MESSAGE_TEXTS[language]["help.option.dry_run"], /^--dry-run: /);
      assert.match(MESSAGE_TEXTS[language]["help.option.vars_file"], /^--vars-file <[^>]+>: /);
      assert.match(MESSAGE_TEXTS[language]["help.exit.run"], /done 0, failed 1, .*70$/);
      assert.match(MESSAGE_TEXTS[language]["doctor.api_key.missing"], /provider_not_configured/);
    }
  });

  test("a pass is always within the configured checks", () => {
    assert.match(MESSAGE_TEXTS.ko["summary.verifiers"], /지정한 검증 범위에서/);
    assert.match(MESSAGE_TEXTS.en["summary.verifiers"], /within the configured checks/);
    assert.match(MESSAGE_TEXTS.ko["reason.verified"], /지정한 검증/);
  });
});
