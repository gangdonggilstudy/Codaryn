/**
 * N-4 language choice: CODARYN_LANG → config `language` → OS display language (Korean → ko,
 * else en). Every input is injected; nothing is read from this machine except in the one test
 * of processLanguageInputs. Values used here are fake and carry "probe" so a leak is easy to see.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CODARYN_LANG_ENV,
  DEFAULT_LANGUAGE,
  localeLanguage,
  osLanguage,
  parseLanguage,
  processLanguageInputs,
  resolveLanguage,
  translate,
} from "../../../src/i18n/index.js";
import type { LanguageInputs } from "../../../src/i18n/index.js";

const NO_OS: Pick<LanguageInputs, "platform" | "intlLocale"> = { platform: "linux", intlLocale: null };

function inputs(over: Partial<LanguageInputs>): LanguageInputs {
  return { env: {}, platform: "linux", intlLocale: null, ...over };
}

describe("i18n language: precedence", () => {
  test("CODARYN_LANG wins over the config file and the operating system", () => {
    const choice = resolveLanguage(
      inputs({ env: { [CODARYN_LANG_ENV]: "en", LANG: "ko_KR.UTF-8" }, configLanguage: "ko", intlLocale: "ko-KR" }),
    );
    assert.deepEqual(choice, { language: "en", source: "CODARYN_LANG", ignored: [] });

    const ko = resolveLanguage(inputs({ env: { [CODARYN_LANG_ENV]: "ko", LANG: "en_US.UTF-8" }, configLanguage: "en" }));
    assert.deepEqual(ko, { language: "ko", source: "CODARYN_LANG", ignored: [] });
  });

  test("the config file's language is used when CODARYN_LANG is unset or blank", () => {
    for (const env of [{}, { [CODARYN_LANG_ENV]: "" }, { [CODARYN_LANG_ENV]: "   " }]) {
      const choice = resolveLanguage(inputs({ env: { ...env, LANG: "en_US.UTF-8" }, configLanguage: "ko" }));
      assert.deepEqual(choice, { language: "ko", source: "config", ignored: [] });
    }
  });

  test("the operating system decides when neither setting is present", () => {
    assert.deepEqual(resolveLanguage(inputs({ env: { LANG: "ko_KR.UTF-8" } })), { language: "ko", source: "os", ignored: [] });
    assert.deepEqual(resolveLanguage(inputs({ env: { LANG: "de_DE.UTF-8" } })), { language: "en", source: "os", ignored: [] });
    assert.deepEqual(resolveLanguage(inputs({ configLanguage: null, platform: "win32", intlLocale: "ko-KR" })), {
      language: "ko",
      source: "os",
      ignored: [],
    });
  });

  test("with no locale at all the default is en, and says so", () => {
    assert.equal(DEFAULT_LANGUAGE, "en");
    assert.deepEqual(resolveLanguage(inputs({})), { language: "en", source: "default", ignored: [] });
    assert.deepEqual(resolveLanguage(inputs({ platform: "win32", intlLocale: "und" })), { language: "en", source: "default", ignored: [] });
  });

  test("a setting that is neither ko nor en is skipped and named in ignored, without its value", () => {
    const choice = resolveLanguage(
      inputs({ env: { [CODARYN_LANG_ENV]: "probe-fr-value", LANG: "ko_KR.UTF-8" }, configLanguage: "probe-config-value" }),
    );
    assert.deepEqual(choice, { language: "ko", source: "os", ignored: ["CODARYN_LANG", "config"] });
    assert.ok(!JSON.stringify(choice).includes("probe"));

    const nonString = resolveLanguage(inputs({ configLanguage: 7, env: { LANG: "en_US" } }));
    assert.deepEqual(nonString, { language: "en", source: "os", ignored: ["config"] });

    const bad = resolveLanguage(inputs({ env: { [CODARYN_LANG_ENV]: "probe-bad" }, configLanguage: "en" }));
    assert.deepEqual(bad, { language: "en", source: "config", ignored: ["CODARYN_LANG"] });
  });

  test("the notice for an ignored setting names the setting, never the value, in both languages", () => {
    const choice = resolveLanguage(inputs({ env: { [CODARYN_LANG_ENV]: "probe-env-7731" }, configLanguage: "probe-file-7731" }));
    for (const language of ["ko", "en"] as const) {
      for (const setting of choice.ignored) {
        const line = translate(language, "language.ignored", { setting });
        assert.ok(!line.includes("probe"), line);
        assert.ok(!line.includes("7731"), line);
      }
      const current = translate(language, "language.current", { language: choice.language, source: choice.source });
      assert.ok(!current.includes("probe"), current);
    }
    assert.match(translate("ko", "language.ignored", { setting: "CODARYN_LANG" }), /^CODARYN_LANG 값이 ko나 en이 아니어서 무시했습니다\.$/);
    assert.equal(translate("en", "language.ignored", { setting: "config" }), "Ignored the config file's language: it is neither ko nor en.");
  });
});

describe("i18n language: parsing", () => {
  test("parseLanguage accepts ko and en ignoring case and surrounding space, nothing else", () => {
    assert.equal(parseLanguage("ko"), "ko");
    assert.equal(parseLanguage(" EN "), "en");
    assert.equal(parseLanguage("Ko"), "ko");
    for (const value of ["ko-KR", "en_US", "kor", "korean", "", "k o", undefined, null, 1, {}, ["ko"]]) {
      assert.equal(parseLanguage(value), null, String(value));
    }
  });

  test("localeLanguage reads the language subtag of POSIX and BCP 47 forms", () => {
    assert.equal(localeLanguage("ko_KR.UTF-8"), "ko");
    assert.equal(localeLanguage("ko-KR"), "ko");
    assert.equal(localeLanguage("KO"), "ko");
    assert.equal(localeLanguage("en_GB@euro"), "en");
    assert.equal(localeLanguage("zh-Hant-TW"), "zh");
    assert.equal(localeLanguage(""), null);
    assert.equal(localeLanguage("1x"), null);
    assert.equal(localeLanguage(null), null);
  });
});

describe("i18n language: operating system", () => {
  test("POSIX: LC_ALL over LC_MESSAGES over LANG", () => {
    assert.equal(osLanguage({ ...NO_OS, env: { LC_ALL: "ko_KR.UTF-8", LC_MESSAGES: "en_US", LANG: "en_US" } }), "ko");
    assert.equal(osLanguage({ ...NO_OS, env: { LC_ALL: "", LC_MESSAGES: "ko_KR", LANG: "en_US" } }), "ko");
    assert.equal(osLanguage({ ...NO_OS, env: { LC_MESSAGES: "en_US.UTF-8", LANG: "ko_KR.UTF-8" } }), "en");
    assert.equal(osLanguage({ ...NO_OS, env: { LANG: "ko_KR.eucKR" } }), "ko");
  });

  test("POSIX: C and POSIX locales are English, and LANGUAGE does not apply to them", () => {
    assert.equal(osLanguage({ ...NO_OS, env: { LANG: "C", LANGUAGE: "ko" } }), "en");
    assert.equal(osLanguage({ ...NO_OS, env: { LC_ALL: "C.UTF-8", LANGUAGE: "ko" } }), "en");
    assert.equal(osLanguage({ ...NO_OS, env: { LANG: "POSIX" } }), "en");
  });

  test("POSIX: the first ko or en entry of LANGUAGE wins over the locale", () => {
    assert.equal(osLanguage({ ...NO_OS, env: { LANG: "en_US.UTF-8", LANGUAGE: "ko_KR:en" } }), "ko");
    assert.equal(osLanguage({ ...NO_OS, env: { LANG: "ko_KR.UTF-8", LANGUAGE: "fr:en:ko" } }), "en");
    assert.equal(osLanguage({ ...NO_OS, env: { LANG: "ko_KR.UTF-8", LANGUAGE: "fr:de" } }), "ko");
    assert.equal(osLanguage({ ...NO_OS, env: { LANG: "ko_KR.UTF-8", LANGUAGE: "" } }), "ko");
  });

  test("POSIX without locale variables falls back to the runtime locale", () => {
    assert.equal(osLanguage({ platform: "darwin", env: {}, intlLocale: "ko-KR" }), "ko");
    assert.equal(osLanguage({ platform: "darwin", env: {}, intlLocale: "en-US" }), "en");
    assert.equal(osLanguage({ platform: "linux", env: {}, intlLocale: null }), null);
  });

  test("Windows uses the runtime locale and ignores LANG and LC_* from a POSIX shell", () => {
    assert.equal(osLanguage({ platform: "win32", env: { LANG: "en_US.UTF-8", LC_ALL: "en_US" }, intlLocale: "ko-KR" }), "ko");
    assert.equal(osLanguage({ platform: "win32", env: { LANG: "ko_KR.UTF-8" }, intlLocale: "en-US" }), "en");
    assert.equal(osLanguage({ platform: "win32", env: {}, intlLocale: "ja-JP" }), "en");
    assert.equal(osLanguage({ platform: "win32", env: {}, intlLocale: null }), null);
  });
});

describe("i18n language: this process", () => {
  test("processLanguageInputs passes the given environment and reads platform and locale only", () => {
    const env = { [CODARYN_LANG_ENV]: "ko" };
    const read = processLanguageInputs(env);
    assert.equal(read.env, env);
    assert.equal(read.platform, process.platform);
    assert.ok(read.intlLocale === null || typeof read.intlLocale === "string");
    assert.equal(resolveLanguage({ ...read, configLanguage: undefined }).language, "ko");
  });
});
