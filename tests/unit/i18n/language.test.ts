/**
 * N-4 language choice (SelectMessageLanguage): CODARYN_LANG → config `language` → OS display
 * language (a `ko` locale gives ko) → en. Every input is injected.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { localeLanguage, parseMessageLanguage, runtimeLocale, selectMessageLanguage } from "../../../src/i18n/index.js";
import type { MessageLanguageInput } from "../../../src/contracts/index.js";

function select(over: Partial<MessageLanguageInput>): string {
  return selectMessageLanguage({ env: null, config: null, osLocale: null, ...over });
}

describe("i18n language: precedence", () => {
  test("CODARYN_LANG wins over the config file and the operating system", () => {
    assert.equal(select({ env: "en", config: "ko", osLocale: "ko-KR" }), "en");
    assert.equal(select({ env: "ko", config: "en", osLocale: "en-US" }), "ko");
  });

  test("CODARYN_LANG is trimmed and read in any case", () => {
    assert.equal(select({ env: " KO ", osLocale: "en-US" }), "ko");
    assert.equal(select({ env: "En", osLocale: "ko-KR" }), "en");
  });

  test("a CODARYN_LANG that is neither ko nor en is ignored", () => {
    for (const env of ["", "   ", "fr", "ko-KR", "korean", "probe-env-7731"]) {
      assert.equal(select({ env, config: "ko", osLocale: "en-US" }), "ko", env);
      assert.equal(select({ env, config: null, osLocale: "en-US" }), "en", env);
    }
  });

  test("the config file's language comes next", () => {
    assert.equal(select({ config: "ko", osLocale: "en-US" }), "ko");
    assert.equal(select({ config: "en", osLocale: "ko-KR" }), "en");
  });

  test("a config value that is not ko or en is skipped (callers outside the type checker)", () => {
    assert.equal(select({ config: "probe" as "ko", osLocale: "ko-KR" }), "ko");
    assert.equal(select({ config: 3 as unknown as "ko", osLocale: null }), "en");
  });

  test("the operating system's locale: ko gives ko, anything else en", () => {
    for (const osLocale of ["ko-KR", "ko", "KO-kr", "ko_KR.UTF-8", "ko-Kore-KR"]) assert.equal(select({ osLocale }), "ko", osLocale);
    for (const osLocale of ["en-US", "ja-JP", "zh-Hant-TW", "kok-IN", "und", "", "C", null]) assert.equal(select({ osLocale }), "en", String(osLocale));
  });

  test("the result is always a language code, whatever the inputs hold", () => {
    const probes = ["C:\\Users\\probe-user\\x", "\u001b[31m", "sk-probe", "{}", "ko\nen"];
    for (const env of probes) {
      for (const osLocale of probes) {
        const language = select({ env, osLocale });
        assert.ok(language === "ko" || language === "en", language);
      }
    }
  });
});

describe("i18n language: helpers", () => {
  test("parseMessageLanguage accepts ko and en only", () => {
    assert.equal(parseMessageLanguage("ko"), "ko");
    assert.equal(parseMessageLanguage(" EN "), "en");
    for (const value of ["ko-KR", "kor", "", undefined, null, 1, {}, ["ko"]]) assert.equal(parseMessageLanguage(value), null, String(value));
  });

  test("localeLanguage reads the language subtag of BCP 47 and POSIX forms", () => {
    assert.equal(localeLanguage("ko_KR.UTF-8"), "ko");
    assert.equal(localeLanguage("ko-KR"), "ko");
    assert.equal(localeLanguage("en_GB@euro"), "en");
    assert.equal(localeLanguage("zh-Hant-TW"), "zh");
    assert.equal(localeLanguage(""), null);
    assert.equal(localeLanguage("1x"), null);
    assert.equal(localeLanguage(null), null);
  });

  test("runtimeLocale gives the runtime's locale tag or null", () => {
    const locale = runtimeLocale();
    assert.ok(locale === null || (typeof locale === "string" && locale.length > 0));
    assert.ok(["ko", "en"].includes(select({ osLocale: locale })));
  });
});
