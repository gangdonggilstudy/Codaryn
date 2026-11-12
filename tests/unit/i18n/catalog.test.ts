/**
 * N-4 catalog: both languages have every message and every code, each message is one clean
 * line that uses all its parameters, codes stay English, and the wording keeps the UX rules.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CLI_ERROR_EXIT_CODES,
  DOCTOR_CHECK_IDS,
  DOCTOR_CHECK_STATUSES,
  INTEGRITY_PHASES,
  MODEL_ERROR_KINDS,
  PERMISSION_KINDS,
  POLICY_DENIAL_CODES,
  TERMINAL_RUN_STATUSES,
  TOOL_ERROR_CODES,
  TOOL_NAMES,
} from "../../../src/contracts/index.js";
import { EN_MESSAGES, EN_TERMS } from "../../../src/i18n/en.js";
import { KO_MESSAGES, KO_TERMS } from "../../../src/i18n/ko.js";
import {
  createTranslator,
  LANGUAGE_SOURCES,
  LANGUAGES,
  MESSAGE_PARAMS,
  REPLACEMENT,
  TERM_KINDS,
  termLabel,
  translate,
} from "../../../src/i18n/index.js";
import type { Language, MessageKey, TermKind } from "../../../src/i18n/index.js";
import { CONTROL, codesOf, KEYS, LANGS, paramsFor, samples, specOf } from "./support.js";

const HANGUL = /[가-힣]/u;

function render(language: Language, key: MessageKey, params: Record<string, unknown>): string {
  return (translate as (l: Language, k: MessageKey, p: Record<string, unknown>) => string)(language, key, params);
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

describe("i18n catalog: completeness", () => {
  test("both languages define exactly the message keys of the spec", () => {
    assert.deepEqual(sorted(Object.keys(KO_MESSAGES)), sorted(KEYS));
    assert.deepEqual(sorted(Object.keys(EN_MESSAGES)), sorted(KEYS));
    assert.ok(KEYS.length >= 80, `only ${KEYS.length} messages`);
  });

  test("both languages label the same codes for every term kind", () => {
    assert.deepEqual(sorted(Object.keys(KO_TERMS)), sorted(TERM_KINDS));
    assert.deepEqual(sorted(Object.keys(EN_TERMS)), sorted(TERM_KINDS));
    for (const kind of TERM_KINDS) {
      assert.deepEqual(sorted(Object.keys(KO_TERMS[kind])), sorted(Object.keys(EN_TERMS[kind])), kind);
      for (const lang of [KO_TERMS, EN_TERMS]) {
        for (const label of Object.values(lang[kind] as Record<string, string>)) assert.ok(label.trim().length > 0, kind);
      }
    }
  });

  test("term kinds cover every code the contracts list", () => {
    const expected: Partial<Record<TermKind, readonly string[]>> = {
      status: TERMINAL_RUN_STATUSES,
      tool: TOOL_NAMES,
      permission: PERMISSION_KINDS,
      denial: [...POLICY_DENIAL_CODES, ...TOOL_ERROR_CODES],
      phase: INTEGRITY_PHASES,
      modelErrorKind: MODEL_ERROR_KINDS,
      checkStatus: DOCTOR_CHECK_STATUSES,
      doctorCheck: DOCTOR_CHECK_IDS,
      errorCode: Object.keys(CLI_ERROR_EXIT_CODES),
      language: LANGUAGES,
      languageSource: LANGUAGE_SOURCES,
    };
    for (const [kind, codes] of Object.entries(expected) as [TermKind, readonly string[]][]) {
      assert.deepEqual(sorted(new Set(codesOf(kind))), sorted(new Set(codes)), kind);
    }
  });
});

describe("i18n catalog: every message in both languages", () => {
  test("renders one non-empty clean line with no leftovers", () => {
    for (const language of LANGS) {
      for (const key of KEYS) {
        const line = render(language, key, paramsFor(key));
        assert.ok(line.trim().length > 0, `${language} ${key}`);
        assert.ok(!CONTROL.test(line), `${language} ${key}: control character`);
        for (const leftover of ["undefined", "NaN", "Infinity", "[object", "${"]) {
          assert.ok(!line.includes(leftover), `${language} ${key}: "${leftover}" in ${line}`);
        }
      }
    }
  });

  test("accepts the sample values: none renders as the replacement mark", () => {
    for (const language of LANGS) {
      for (const key of KEYS) {
        const base = render(language, key, paramsFor(key));
        for (const name of Object.keys(specOf(key))) {
          const invalid = render(language, key, paramsFor(key, { name, value: {} }));
          assert.notEqual(base, invalid, `${language} ${key}: sample for ${name} was rejected`);
        }
      }
    }
  });

  test("uses every parameter: changing one changes the line", () => {
    for (const language of LANGS) {
      for (const key of KEYS) {
        const base = render(language, key, paramsFor(key));
        for (const [name, kind] of Object.entries(specOf(key))) {
          const other = render(language, key, paramsFor(key, { name, value: samples(kind)[1] }));
          assert.notEqual(other, base, `${language} ${key}: parameter ${name} is not used`);
        }
      }
    }
  });

  test("Korean messages are Korean and English messages have no Hangul", () => {
    for (const key of KEYS) {
      assert.match(render("ko", key, paramsFor(key)), HANGUL, `ko ${key}`);
      assert.doesNotMatch(render("en", key, paramsFor(key)), HANGUL, `en ${key}`);
    }
  });

  test("every term code renders in every message that takes it", () => {
    for (const language of LANGS) {
      for (const key of KEYS) {
        for (const [name, kind] of Object.entries(specOf(key))) {
          if (!(TERM_KINDS as readonly string[]).includes(kind)) continue;
          const invalid = render(language, key, paramsFor(key, { name, value: {} }));
          for (const code of codesOf(kind as TermKind)) {
            const line = render(language, key, paramsFor(key, { name, value: code }));
            assert.notEqual(line, invalid, `${language} ${key} ${name}=${code}: ${line}`);
          }
        }
      }
    }
  });
});

describe("i18n catalog: codes stay English", () => {
  test("an error line keeps its code in English, after the Korean or English description", () => {
    for (const code of Object.keys(CLI_ERROR_EXIT_CODES)) {
      const ko = render("ko", "error.title", { code });
      const en = render("en", "error.title", { code });
      assert.ok(ko.startsWith("오류 — ") && ko.endsWith(` (${code})`), ko);
      assert.ok(en.startsWith("error — ") && en.endsWith(` (${code})`), en);
      assert.ok(render("ko", "error.fix", { code }).startsWith("고치는 법: "));
      assert.ok(render("en", "error.fix", { code }).startsWith("To fix: "));
    }
  });

  test("progress lines put the status and reason codes in parentheses after the words", () => {
    assert.equal(
      render("ko", "progress.finished", { status: "done", reason: "verified" }),
      "끝 — 완료: 지정한 검증 모두 통과 (done/verified)",
    );
    assert.equal(
      render("en", "progress.toolDenied", { tool: "run_command", permission: "command", denial: "command_not_allowed" }),
      "run command — denied: not in the allowed commands (command/command_not_allowed)",
    );
    assert.equal(
      render("ko", "progress.toolDenied", { tool: "run_command", permission: "command", denial: "command_not_allowed" }),
      "명령 실행 — 거부: 허용 목록에 없음 (command/command_not_allowed)",
    );
  });
});

describe("i18n catalog: wording rules (UX 1 and 5)", () => {
  // Codaryn has no OS isolation (M-8) and masking is not encryption: these words would overclaim.
  const OVERCLAIM_KO = ["안전", "샌드박스", "차단", "암호화", "보장"];
  const OVERCLAIM_EN = [/\bsafe/i, /sandbox/i, /\bblock/i, /encrypt/i, /\bsecure/i, /guarantee/i];

  function everyText(language: Language): string[] {
    const terms = language === "ko" ? KO_TERMS : EN_TERMS;
    const labels = TERM_KINDS.flatMap((kind) => Object.values(terms[kind] as Record<string, string>));
    const lines = KEYS.flatMap((key) => {
      const out = [render(language, key, paramsFor(key))];
      for (const [name, kind] of Object.entries(specOf(key))) {
        if ((TERM_KINDS as readonly string[]).includes(kind)) {
          for (const code of codesOf(kind as TermKind)) out.push(render(language, key, paramsFor(key, { name, value: code })));
        }
      }
      return out;
    });
    return [...labels, ...lines];
  }

  test("no message claims protection Codaryn does not give", () => {
    for (const text of everyText("ko")) {
      for (const word of OVERCLAIM_KO) assert.ok(!text.includes(word), `ko "${word}": ${text}`);
    }
    for (const text of everyText("en")) {
      for (const word of OVERCLAIM_EN) assert.doesNotMatch(text, word, text);
    }
  });

  test("passing is always within the configured checks", () => {
    assert.match(render("ko", "summary.verifiers", { passed: 1, total: 2 }), /지정한 검증 범위에서/);
    assert.match(render("en", "summary.verifiers", { passed: 1, total: 2 }), /within the configured checks/);
    assert.match(render("ko", "summary.title", { status: "done", reason: "verified" }), /지정한 검증 모두 통과/);
  });

  test("the key is never asked for: guidance only names the variable", () => {
    for (const language of LANGS) {
      for (const key of ["key.howToWindows", "key.howToPosix", "key.howToVarsFile", "key.neverAsked"] as const) {
        const line = render(language, key, {});
        assert.doesNotMatch(line, /ANTHROPIC_API_KEY\s*[=:]/, line);
      }
    }
  });
});

describe("i18n translator", () => {
  test("createTranslator renders in its language and falls back to en for an unknown one", () => {
    const ko = createTranslator("ko");
    assert.equal(ko.language, "ko");
    assert.equal(ko.t("error.title", { code: "invalid_config" }), "오류 — 설정 파일을 읽을 수 없거나 값이 올바르지 않습니다 (invalid_config)");
    assert.equal(ko.t("error.check"), "점검: codaryn doctor");
    assert.equal(ko.term("status", "needs-input"), "확인 필요");

    const fallback = createTranslator("fr" as Language);
    assert.equal(fallback.language, "en");
    assert.equal(fallback.t("revert.alreadyReverted"), "This run was already reverted.");
  });

  test("an unknown key or code gives the replacement mark, not the key or code", () => {
    assert.equal(render("en", "probe.unknown" as MessageKey, {}), REPLACEMENT);
    assert.equal(render("ko", "__proto__" as MessageKey, {}), REPLACEMENT);
    assert.equal(termLabel("ko", "status", "probe-status" as "done"), REPLACEMENT);
    assert.equal(termLabel("en", "reason", "toString" as "verified"), REPLACEMENT);
  });

  test("missing parameters render as the replacement mark", () => {
    assert.equal(render("en", "progress.turn", {}), "turn ?");
    assert.equal(render("ko", "summary.title", {}), "── 결과: ? — ? ──");
  });

  test("English counts agree in number", () => {
    assert.equal(render("en", "summary.changes", { count: 1 }), "1 file changed");
    assert.equal(render("en", "summary.changes", { count: 2 }), "2 files changed");
    assert.equal(render("en", "summary.changes", { count: 0 }), "0 files changed");
    assert.equal(render("en", "revert.partial", { reverted: 1, skipped: 2 }), "Reverted 1 file and skipped 2.");
    assert.equal(render("en", "progress.repair", { attempt: 2, failed: 1 }), "repair 2 — 1 check failed");
  });

  test("the spec has a group prefix on every key", () => {
    for (const key of Object.keys(MESSAGE_PARAMS)) assert.match(key, /^[a-z]+\.[A-Za-z]+$/, key);
  });
});
