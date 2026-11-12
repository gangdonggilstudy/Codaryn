/**
 * N-4 catalog (CreateMessageCatalog): both languages have every MessageId, each template uses
 * exactly its parameters, `format` throws on a wrong id or parameter set, every message is one
 * clean line, and the wording keeps the UX rules.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  API_KEY_ENVS,
  CLI_ERROR_EXIT_CODES,
  INPUT_DIAGNOSTIC_FILES,
  MESSAGE_IDS,
  RUN_REASONS,
  TERMINAL_RUN_STATUSES,
  UNSAFE_MOVE_CONSENT_ARGUMENT,
} from "../../../src/contracts/index.js";
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
      assert.doesNotMatch(MESSAGE_TEXTS.en[id], HANGUL, `en ${id}`);
      // `summary.form.*` are command fragments put into a command line: the same in both languages.
      if (id.startsWith("summary.form.")) {
        assert.equal(MESSAGE_TEXTS.ko[id], MESSAGE_TEXTS.en[id], id);
        assert.match(MESSAGE_TEXTS.ko[id], /^--[a-z]+ \S+$/, id);
        continue;
      }
      assert.match(MESSAGE_TEXTS.ko[id], HANGUL, `ko ${id}`);
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

  test("the unsafe move consent hint uses the contract's argument; approval words name no flag (DR-21)", () => {
    for (const language of LANGS) {
      assert.ok(MESSAGE_TEXTS[language]["summary.next_apply_unsafe"].includes(UNSAFE_MOVE_CONSENT_ARGUMENT), language);
      assert.ok(MESSAGE_TEXTS[language]["summary.next_revert_unsafe"].includes(UNSAFE_MOVE_CONSENT_ARGUMENT), language);
      assert.ok(MESSAGE_TEXTS[language]["help.option.allow_unsafe_move"].startsWith(`${UNSAFE_MOVE_CONSENT_ARGUMENT}:`), language);
      assert.ok(MESSAGE_TEXTS[language]["advice.consent_required"].includes(UNSAFE_MOVE_CONSENT_ARGUMENT), language);
      // approval.<channel> words serve both the plan approval and the consent line.
      for (const id of ["approval.cli-tty", "approval.cli-flag", "approval.adapter"] as const) {
        assert.doesNotMatch(MESSAGE_TEXTS[language][id], /--[a-z]/, `${language} ${id}`);
      }
    }
  });

  test("the lock hint names both files a person may remove (DR-27 b)", () => {
    for (const language of LANGS) {
      for (const id of ["lock.remove_hint", "doctor.lock.reclaim_left"] as const) {
        assert.ok(MESSAGE_TEXTS[language][id].includes(".codaryn/lock.json.reclaim"), `${language} ${id}`);
      }
      assert.match(MESSAGE_TEXTS[language]["lock.remove_hint"], /\.codaryn\/lock\.json(?!\.)/, language);
    }
  });

  test("the next bundle's texts take only their closed parameters (DR-38, DR-39, N-A 32.3 and 33.3)", () => {
    for (const language of LANGS) {
      const format = loose(createMessageCatalog(language));
      // A config file given by --config or CODARYN_CONFIG; the Korean particle does not depend on it.
      for (const location of ["--config", "CODARYN_CONFIG"]) {
        assert.ok(format("doctor.config_file.valid_given", { location }).includes(location), `${language} ${location}`);
      }
      // The model's variable and config place: shown as given only when they are closed values.
      const missing = format("doctor.model.missing", { variable: "CODARYN_OPENAI_MODEL", field: "providers.openai.model" });
      assert.ok(missing.includes("CODARYN_OPENAI_MODEL") && missing.includes("providers.openai.model"), missing);
      assert.ok(!format("doctor.model.missing", { variable: "MY_SECRET_VALUE", field: "x y" }).includes("MY_SECRET_VALUE"), language);
      // Sizes are whole byte counts; anything else is the replacement mark.
      assert.ok(format("cleanup.summary.runs", { count: 3, bytes: 1048576 }).includes("1048576"), language);
      assert.ok(format("cleanup.done", { runs: 2, folders: 1, bytes: -5 }).includes("?"), language);
      assert.ok(format("cleanup.confirm.discarded", { files: 1.5, bytes: 10 }).includes("?"), language);
    }
    // No new text names a provider's variable itself (SP-D12, DR-34): only {variable} does.
    for (const id of ["doctor.model.missing", "doctor.model.output_cap_missing"] as const) {
      for (const language of LANGS) assert.ok(!/CODARYN_[A-Z_]*MODEL|maxOutputTokens or config maxOutputTokens/.test(MESSAGE_TEXTS[language][id]), `${language} ${id}`);
    }
  });

  test("the cleanup headings state what a confirmation removes; they do not ask (R-34 I-2)", () => {
    // The CLI prints them in a preview that asks nothing (the person confirms with --confirm), and
    // the GUI shows them above its own buttons: a question would wait for an answer that never comes.
    for (const id of ["cleanup.confirm.runs", "cleanup.confirm.discarded", "cleanup.confirm.not_reverted", "cleanup.confirm.leftovers"] as const) {
      assert.ok(!MESSAGE_TEXTS.en[id].includes("?"), `en ${id}`);
      assert.ok(!/까요|습니까|\?/.test(MESSAGE_TEXTS.ko[id]), `ko ${id}`);
    }
  });

  test("DR-44: the cleanup texts say what is lost, and name no option the GUI does not have", () => {
    for (const language of LANGS) {
      const t = MESSAGE_TEXTS[language];
      // Shown by the CLI and the GUI alike: the CLI's own option is not in it.
      assert.ok(!t["cleanup.confirm.not_reverted"].includes("--"), language);
      // A run not reverted, or only partly reverted, can no longer be reverted without its records.
      for (const id of ["cleanup.confirm.not_reverted", "cleanup.warning.not_reverted", "cleanup.warning.partly_reverted"] as const) {
        assert.ok(language === "en" ? /can no longer be reverted/.test(t[id]) : /더는 되돌릴 수 없/.test(t[id]), `${language} ${id}`);
      }
    }
    // discarded_left is conditional (DR-44 (c)): the files may stay or go.
    assert.match(MESSAGE_TEXTS.en["cleanup.warning.discarded_left"], /\bif\b/);
    assert.match(MESSAGE_TEXTS.ko["cleanup.warning.discarded_left"], /남으면/);
  });

  test("R-34b: a damaged run's warning and the separate confirmation name it; an unknown folder is never removed", () => {
    const { en, ko } = MESSAGE_TEXTS;
    // P-1: records that cannot be checked go with the not reverted confirmation, and that line says so.
    assert.match(en["cleanup.confirm.not_reverted"], /records cannot be checked/);
    assert.match(ko["cleanup.confirm.not_reverted"], /기록을 확인할 수 없는/);
    assert.match(en["cleanup.warning.records_unreadable"], /cannot be checked.*may remove the last copies/);
    assert.match(ko["cleanup.warning.records_unreadable"], /확인할 수 없.*마지막 사본도 지워질 수 있음/);
    // P-2: a folder named like a leftover without its mark is shown and kept.
    assert.match(en["cleanup.summary.unknown_folders"], /never removed/);
    assert.match(ko["cleanup.summary.unknown_folders"], /지우지 않음/);
    for (const id of ["cleanup.summary.unknown_folders", "cleanup.warning.records_unreadable"] as const) {
      assert.ok(!en[id].includes("--") && !ko[id].includes("--"), `${id} names no CLI option`);
    }
  });

  test("the revert preview's next line says to revert, not to apply (catalog review, docs/usage.md bf4cb53)", () => {
    // `apply` is a command of its own; the English line matches docs/usage.md, which n01 compares.
    assert.equal(MESSAGE_TEXTS.en["revert.dry_run_next"], "Run again without --dry-run to revert.");
    // R-26 L-2: the Korean line says the same, "to revert" (되돌리려면), not "to run" (실행하려면).
    assert.equal(MESSAGE_TEXTS.ko["revert.dry_run_next"], "되돌리려면 --dry-run 없이 다시 실행하세요.");
  });

  test("no text names VS Code: the app is the standalone GUI only (DR-20)", () => {
    for (const language of LANGS) {
      for (const id of IDS) assert.ok(!MESSAGE_TEXTS[language][id].includes("VS Code"), `${language} ${id}`);
    }
  });

  test("revert's help covers a plan's moves and discards too (G-E)", () => {
    const ko = MESSAGE_TEXTS.ko["help.command.revert"];
    const en = MESSAGE_TEXTS.en["help.command.revert"];
    assert.ok(ko.includes("이동") && ko.includes("폐기"), ko);
    assert.match(en, /\bmoves?\b/, en);
    assert.match(en, /\bdiscard/, en);
  });

  test("the discarded files folder has one Korean name (DR-9: 폐기 보관함)", () => {
    for (const id of ["progress.file_discarded", "revert.action.restored_from_discard"] as const) {
      assert.ok(MESSAGE_TEXTS.ko[id].includes("폐기 보관함"), id);
    }
    for (const id of IDS) assert.ok(!MESSAGE_TEXTS.ko[id].includes("버린 파일 보관"), id);
  });

  test("the Korean particle after {keyEnv} fits every key variable name (SP-D12)", () => {
    // ko writes "{keyEnv}가" and "{keyEnv}를", which fit a name read with a final vowel: every name
    // ends in KEY ("키"). A new name that does not would need these texts reworded.
    for (const name of API_KEY_ENVS) assert.ok(name.endsWith("_KEY"), name);
    for (const id of IDS.filter((id) => Object.values(specOf(id)).includes("keyEnv"))) {
      assert.match(MESSAGE_TEXTS.ko[id], /\{keyEnv\}(가|를| )/, id);
    }
  });

  test("the quick form hint names the quick form and the --task form (R-12 L-2)", () => {
    for (const language of LANGS) {
      const text = MESSAGE_TEXTS[language]["error.hint.quick_form_needs_task"];
      assert.ok(text.includes("--workspace") && text.includes("--task"), language);
    }
  });

  test("the parked files texts name the folder they are left in (R-16 L-1)", () => {
    for (const language of LANGS) {
      for (const id of ["revert.parked", "doctor.lock.parked_left"] as const) {
        assert.ok(MESSAGE_TEXTS[language][id].includes(".codaryn/parked/"), `${language} ${id}`);
      }
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
