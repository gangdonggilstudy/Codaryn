/**
 * U-38 (DR-51): an end summary's next-command hints may show the workspace path the person typed,
 * in place of `<workspace>`. The `*_typed` texts are today's hints with `{workspace}` there, and the
 * catalog takes for it only a ShownWorkspace exactly as the contract's `toShownWorkspace` makes it:
 * the typed path in double quotes after masking, never a value that holds a key shape, a
 * privacy-token fragment or a character that cannot stand in double quotes in a shell.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MAX_SHOWN_WORKSPACE_CHARS, toShownWorkspace } from "../../../src/contracts/index.js";
import type { MessageId } from "../../../src/contracts/index.js";
import { createMessageCatalog, MESSAGE_TEXTS, REPLACEMENT } from "../../../src/i18n/index.js";
import { KEY_SHAPED, loose } from "./support.js";

const RUN = "20261113T010203Z-0123abcd";
const PAIRS = [
  ["summary.next_report", "summary.next_report_typed"],
  ["summary.next_revert", "summary.next_revert_typed"],
  ["summary.form.given", "summary.form.typed"],
  ["summary.next_revert_unsafe", "summary.next_revert_unsafe_typed"],
] as const satisfies readonly (readonly [MessageId, MessageId])[];

describe("U-38: the next-command hints with the typed workspace", () => {
  test("each typed hint is today's hint with {workspace} in place of <workspace>", () => {
    for (const language of ["en", "ko"] as const) {
      const t = MESSAGE_TEXTS[language];
      for (const [placeholder, typed] of PAIRS) {
        assert.equal(t[typed], t[placeholder].replace("<workspace>", "{workspace}"), `${language} ${typed}`);
        assert.equal(t[typed].split("{workspace}").length, 2, `${language} ${typed}: once`);
        assert.ok(!t[typed].includes("<workspace>"), `${language} ${typed}`);
      }
    }
  });

  test("a path toShownWorkspace gives is shown as it is, in its quotes", () => {
    const typed = "D:\\projects\\site notes";
    const shown = toShownWorkspace(typed, typed);
    assert.equal(shown, `"${typed}"`);
    for (const language of ["en", "ko"] as const) {
      const format = loose(createMessageCatalog(language));
      assert.ok(format("summary.next_report_typed", { runId: RUN, workspace: shown }).endsWith(`--workspace "${typed}" --run ${RUN}`), language);
      assert.equal(format("summary.form.typed", { workspace: shown }), `--workspace "${typed}"`, language);
      assert.ok(format("summary.next_revert_unsafe_typed", { runId: RUN, workspace: shown }).endsWith(`--workspace "${typed}" --run ${RUN} --allow-unsafe-move`), language);
    }
  });

  test("anything else in its place is the replacement, never the value", () => {
    const format = loose(createMessageCatalog("en"));
    const refused = [
      "D:\\projects\\site", // not quoted
      '"a$b"', // expands in a shell
      '"a%b%"',
      '"a`b"',
      '"a!b"',
      '"a\\"', // its backslash would escape the closing quote
      `"${KEY_SHAPED}"`, // a key shape
      '"codaryn_secret_1"', // a privacy-token fragment
      `"${"a".repeat(MAX_SHOWN_WORKSPACE_CHARS + 1)}"`, // too long
      '"a\u202eb"', // a bidirectional control
      '"   "',
      42,
      null,
    ];
    for (const value of refused) {
      assert.equal(format("summary.form.typed", { workspace: value }), `--workspace ${REPLACEMENT}`, String(value));
    }
  });
});
