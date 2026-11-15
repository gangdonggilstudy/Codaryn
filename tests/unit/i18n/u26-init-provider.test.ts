/**
 * U-26: `codaryn init` asks for the provider at a terminal. init.provider_pick is the question, its
 * `{provider}` the default Enter gives (INIT_DEFAULT_PROVIDER); the CLI lists the providers numbered
 * above it, by their code names. An answer not in the list gives the default too, so
 * init.provider_chosen says which provider the file is written for, before the model question.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { INIT_DEFAULT_PROVIDER } from "../../../src/contracts/index.js";
import { createMessageCatalog, MESSAGE_TEXTS, PLACEHOLDER } from "../../../src/i18n/index.js";

const HANGUL = /[가-힣]/u;
const IDS = ["init.provider_pick", "init.provider_chosen"] as const;

function placeholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1] as string);
}

describe("U-26: init's provider question", () => {
  test("both texts take the provider once, and the Korean is in Korean with no particle after it", () => {
    for (const language of ["en", "ko"] as const) {
      for (const id of IDS) {
        const text = MESSAGE_TEXTS[language][id];
        assert.deepEqual(placeholders(text), ["provider"], `${language} ${id}`);
        if (language === "ko") {
          assert.ok(HANGUL.test(text), id);
          // The name is a code (anthropic, openai): what follows it must not change with how it reads.
          assert.match(text, /\{provider\}[).]/, id);
        }
      }
    }
  });

  test("the question: by number or name; Enter, or an answer not listed, gives the default", () => {
    assert.equal(INIT_DEFAULT_PROVIDER, "anthropic");
    const en = createMessageCatalog("en").format("init.provider_pick", { provider: INIT_DEFAULT_PROVIDER });
    const ko = createMessageCatalog("ko").format("init.provider_pick", { provider: INIT_DEFAULT_PROVIDER });
    assert.equal(en, "Choose the provider by number or name (Enter, or an answer not listed, gives anthropic).");
    assert.equal(ko, "제공자를 번호나 이름으로 고르세요(Enter나 목록에 없는 답이면 anthropic).");
    // As the other init questions say what Enter does (init.model_pick, init.language_pick).
    for (const language of ["en", "ko"] as const) assert.ok(MESSAGE_TEXTS[language]["init.model_pick"].includes("Enter"), language);
  });

  test("the chosen line names the provider the config file is written for", () => {
    assert.equal(createMessageCatalog("en").format("init.provider_chosen", { provider: "openai" }), "Provider: openai. The config file is written for it.");
    assert.equal(createMessageCatalog("ko").format("init.provider_chosen", { provider: "openai" }), "제공자: openai. 설정 파일을 이 제공자에 맞춰 씁니다.");
  });
});
