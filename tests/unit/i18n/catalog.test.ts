/**
 * N-4 catalog (CreateMessageCatalog): both languages have every MessageId, each template uses
 * exactly its parameters, `format` throws on a wrong id or parameter set, every message is one
 * clean line, and the wording keeps the UX rules.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CLI_ERROR_EXIT_CODES, MESSAGE_IDS, RUN_REASONS, TERMINAL_RUN_STATUSES } from "../../../src/contracts/index.js";
import type { MessageCatalog, MessageId, MessageLanguage, MessageParams } from "../../../src/contracts/index.js";
import { createMessageCatalog, MESSAGE_TEXTS, MessageFormatError, PLACEHOLDER, REPLACEMENT } from "../../../src/i18n/index.js";
import { CONTROL, IDS, LANGS, paramsFor, samples, specOf } from "./support.js";

const HANGUL = /[가-힣]/u;

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

function placeholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1] as string);
}

function format(catalog: MessageCatalog, id: MessageId, params: Record<string, unknown>): string {
  return catalog.format(id, params as MessageParams);
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
        const used = placeholders(template);
        assert.deepEqual(sorted(used), sorted(Object.keys(specOf(id))), `${language} ${id}`);
        assert.ok(!/[{}]/.test(template.replace(PLACEHOLDER, "")), `${language} ${id}: stray brace`);
        assert.ok(template.trim().length > 0, `${language} ${id}: empty`);
      }
    }
  });

  test("listed ids cover every error code, status, reason and advice", () => {
    const ids = new Set<string>(MESSAGE_IDS);
    for (const code of Object.keys(CLI_ERROR_EXIT_CODES)) {
      assert.ok(ids.has(`error.${code}.what`) && ids.has(`error.${code}.fix`), code);
    }
    for (const status of TERMINAL_RUN_STATUSES) assert.ok(ids.has(`status.${status}`), status);
    for (const reason of RUN_REASONS) assert.ok(ids.has(`reason.${reason}`) && ids.has(`advice.${reason}`), reason);
  });
});

describe("i18n catalog: format", () => {
  test("renders every message in both languages as one non-empty clean line", () => {
    for (const language of LANGS) {
      const catalog = createMessageCatalog(language);
      for (const id of IDS) {
        const line = format(catalog, id, paramsFor(catalog, id));
        assert.ok(line.trim().length > 0, `${language} ${id}`);
        assert.ok(!CONTROL.test(line), `${language} ${id}: control character`);
        for (const leftover of ["undefined", "NaN", "[object", "{", "}"]) assert.ok(!line.includes(leftover), `${language} ${id}: ${line}`);
      }
    }
  });

  test("accepts the sample of every kind and uses every parameter", () => {
    for (const language of LANGS) {
      const catalog = createMessageCatalog(language);
      for (const id of IDS) {
        const base = format(catalog, id, paramsFor(catalog, id));
        for (const [name, kind] of Object.entries(specOf(id))) {
          const rejected = format(catalog, id, paramsFor(catalog, id, { name, value: {} }));
          const other = format(catalog, id, paramsFor(catalog, id, { name, value: samples(kind, catalog)[1] }));
          assert.notEqual(base, rejected, `${language} ${id}: sample for ${name} (${kind}) was rejected`);
          assert.notEqual(base, other, `${language} ${id}: parameter ${name} is not used`);
        }
      }
    }
  });

  test("throws for an unknown id, a missing parameter and an extra parameter, without the values", () => {
    const catalog = createMessageCatalog("en");
    const cases: [() => string, RegExp][] = [
      [() => format(catalog, "probe.unknown" as MessageId, {}), /^unknown message id$/],
      [() => format(catalog, "__proto__" as MessageId, {}), /^unknown message id$/],
      [() => format(catalog, "summary.changes", {}), /^message summary\.changes: missing parameter count$/],
      [() => catalog.format("summary.changes"), /^message summary\.changes: missing parameter count$/],
      [() => format(catalog, "summary.changes", { count: 1, probeExtra: "probe-value" }), /^message summary\.changes: unexpected parameter$/],
      [() => format(catalog, "status.done", { probeExtra: "probe-value" }), /^message status\.done: unexpected parameter$/],
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

  test("examples in both languages", () => {
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
    const status = ko.format("status.done");
    assert.equal(ko.format("progress.finished", { status, reason: "verified" }), "끝 — 완료 (verified)");
    assert.equal(en.format("init.saved", { path: "%APPDATA%\\Codaryn\\config.json" }), "Saved: %APPDATA%\\Codaryn\\config.json");
  });

  test("an unknown language falls back to en", () => {
    const catalog = createMessageCatalog("fr" as MessageLanguage);
    assert.equal(catalog.language, "en");
    assert.equal(catalog.format("status.done"), "done");
  });

  test("text and detail take only what this catalog produced", () => {
    const ko = createMessageCatalog("ko");
    const en = createMessageCatalog("en");
    const fromEn = en.format("status.done");
    assert.equal(ko.format("summary.result", { text: fromEn }), `결과: ${REPLACEMENT}`);
    assert.equal(ko.format("summary.result", { text: "완료" }), `결과: ${REPLACEMENT}`);
    const own = ko.format("status.done");
    assert.equal(ko.format("summary.result", { text: own }), "결과: 완료");
    assert.equal(ko.format("error.detail", { detail: ko.format("error.invalid_task.what") }), "자세히: task 파일을 읽을 수 없거나 값이 올바르지 않습니다");
  });
});

describe("i18n catalog: language and wording", () => {
  test("Korean texts are Korean, English texts have no Hangul", () => {
    for (const id of IDS) {
      assert.match(MESSAGE_TEXTS.ko[id], HANGUL, `ko ${id}`);
      assert.doesNotMatch(MESSAGE_TEXTS.en[id], HANGUL, `en ${id}`);
    }
  });

  test("codes stay English: the status and reason codes pass through unchanged", () => {
    const ko = createMessageCatalog("ko");
    assert.equal(ko.format("progress.model_error", { turn: 3, kind: "auth_failed" }), "3턴 — 모델 호출 오류 (auth_failed)");
    assert.equal(ko.format("progress.integrity_unchanged", { phase: "before_verify" }), "보호 대상 확인 — 바뀌지 않음 (before_verify)");
  });

  test("no text claims protection Codaryn does not give (UX 1.4, M-8)", () => {
    const overclaimKo = ["안전", "샌드박스", "차단", "암호화", "보장"];
    const overclaimEn = [/\bsafe/i, /sandbox/i, /\bblock/i, /encrypt/i, /\bsecure/i, /guarantee/i];
    for (const id of IDS) {
      for (const word of overclaimKo) assert.ok(!MESSAGE_TEXTS.ko[id].includes(word), `ko ${id}: ${word}`);
      for (const word of overclaimEn) assert.doesNotMatch(MESSAGE_TEXTS.en[id], word, `en ${id}`);
    }
  });

  test("a pass is always within the configured checks", () => {
    assert.match(MESSAGE_TEXTS.ko["summary.verifiers"], /지정한 검증 범위에서/);
    assert.match(MESSAGE_TEXTS.en["summary.verifiers"], /within the configured checks/);
    assert.match(MESSAGE_TEXTS.ko["reason.verified"], /지정한 검증/);
  });
});
