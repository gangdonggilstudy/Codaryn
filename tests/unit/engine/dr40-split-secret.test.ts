/**
 * DR-40 (a), second defence (R-25 M-1): a registered key split by a line break or an invisible
 * character, in the goal or in a tool result, must leave no key characters in the model requests or
 * the run record. Driven through the real engine and the real privacy gateway. The fake key below is
 * built at run time and is not a credential.
 *
 * The gateway matches registered values exactly, so a split value passes unmasked. The fix belongs to
 * the gateway (src/privacy, not this owner's): the reproduction is a todo test until then.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { compactKeyText } from "../../../src/contracts/index.js";
import { runTask } from "../../../src/engine/index.js";
import { createPrivacyGateway } from "../../../src/privacy/index.js";
import { FakeTools, HASH_A, finalAnswer, harness, readCall, response } from "./fakes.js";

const p = (...parts: string[]) => parts.join("");
const KEY = p("sk", "-ant-", "api03-", "Ab3dE_f9-hIjK1".repeat(10).slice(0, 91), "AA");
/** The reviewer's split: one character after the 25th. */
const split = (mark: string) => KEY.slice(0, 25) + mark + KEY.slice(25);
const MARKS: Record<string, string> = {
  "zero-width space": String.fromCharCode(0x200b),
  "line feed": String.fromCharCode(10),
  "soft hyphen": String.fromCharCode(0xad),
};
const FRAGMENT = 6;

/**
 * How many of the key's characters appear in `text` as part of a run of FRAGMENT or more of the
 * key's consecutive characters, separators left out (so a split copy counts in full).
 */
function leakedKeyCharacters(text: string): number {
  const compact = compactKeyText(text);
  const covered = new Uint8Array(KEY.length);
  for (let start = 0; start + FRAGMENT <= KEY.length; start += 1) {
    if (compact.includes(KEY.slice(start, start + FRAGMENT))) covered.fill(1, start, start + FRAGMENT);
  }
  return covered.reduce((sum, bit) => sum + bit, 0);
}

async function runWith(keyInText: string) {
  const tools = new FakeTools(() => ({ ok: true, payload: { path: "a.txt", content: `config\napi_key = ${keyInText}\nend\n`, hash: HASH_A, hadBom: false } }));
  const run = harness({
    steps: [() => response([readCall("c1")]), () => finalAnswer()],
    task: { goal: `use the key ${keyInText} to fix a.txt` },
    privacy: createPrivacyGateway({ secrets: [KEY] }),
    tools,
  });
  const result = await runTask(run.deps);
  return {
    requests: leakedKeyCharacters(JSON.stringify(run.model.requests)),
    journal: leakedKeyCharacters(JSON.stringify(run.journal.events)),
    result: leakedKeyCharacters(JSON.stringify(result)),
  };
}

describe("DR-40 (a), second defence: a split registered key leaves nothing in the requests or the record", () => {
  test("control: the key as written is masked everywhere (the measure finds nothing)", async () => {
    assert.equal(KEY.length, 106);
    assert.equal(leakedKeyCharacters(`a ${KEY} b`), KEY.length, "the measure counts a whole key");
    assert.deepEqual(await runWith(KEY), { requests: 0, journal: 0, result: 0 });
  });

  for (const [name, mark] of Object.entries(MARKS)) {
    test(
      `split by a ${name}, in the goal and in a tool result: 0 key characters in the requests and the journal`,
      { todo: "src/privacy (not this owner's): the gateway must also match registered values in the compact view (compactKeyText) and mask the original span" },
      async () => {
        assert.deepEqual(await runWith(split(mark)), { requests: 0, journal: 0, result: 0 });
      },
    );
  }
});
