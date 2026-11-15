/**
 * U-26 (na-core's request, report-N-A.md section 73): `codaryn init` asks which provider the config
 * file is for. The question and the line that says which one was chosen take the provider as a
 * parameter (the default in the question); the default is a contract constant so the CLI, the GUI
 * and the documents see one value. Without the question (not a terminal, `--json`) nothing changes:
 * InitOutput.provider stays absent and the file is written for anthropic as before.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { API_PROVIDER_NAMES, FIXED_MESSAGES, INIT_DEFAULT_PROVIDER, MESSAGE_IDS, messageParams } from "../../../src/contracts/index.js";
import type { ApiProviderName, InitOutput, MessageId } from "../../../src/contracts/index.js";

describe("U-26: init asks for the provider", () => {
  test("the question and the chosen line take the provider", () => {
    const ids = MESSAGE_IDS as readonly string[];
    for (const id of ["init.provider_pick", "init.provider_chosen"]) {
      assert.equal(ids.filter((entry) => entry === id).length, 1, id);
      assert.ok(Object.hasOwn(FIXED_MESSAGES, id), id);
      assert.deepEqual(messageParams(id as MessageId), { provider: "provider" }, id);
    }
  });

  test("the default provider is anthropic, one of the API providers", () => {
    const value: ApiProviderName = INIT_DEFAULT_PROVIDER;
    assert.equal(value, "anthropic");
    assert.ok(API_PROVIDER_NAMES.includes(value));
  });

  test("an init that did not ask has no provider in its output", () => {
    const asked: Pick<InitOutput, "provider"> = { provider: "openai" };
    const notAsked: Pick<InitOutput, "provider"> = {};
    assert.equal(asked.provider, "openai");
    assert.equal(Object.hasOwn(notAsked, "provider"), false);
  });
});
