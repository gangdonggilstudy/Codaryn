/**
 * U-34 (UXM-7, AXM-22; the U-19 survey, section 3 A): a Korean cleanup still told in English an
 * item's size, that a confirmed cleanup removed nothing, how to confirm, that removed records can no
 * longer be reverted, and the names of the three kinds of item. Now each of those lines is a
 * catalog text (contract f95c418):
 * - cleanup.size, cleanup.nothing_removed, cleanup.next.*, cleanup.target.<target>
 * - G-A (0a9f9ec): no text takes the digest. The renderer puts the options after the text on the
 *   same line, one space apart: `--confirm <the digest's first MIN_PLAN_DIGEST_PREFIX characters>`
 *   (and `--delete-discarded`), then the full stop the English line had.
 * A stand-in catalog shows which text each line is; the Korean catalog shows the Korean output.
 * renderCleanup on made-up outputs (u34-cleanup-fixtures). Nothing is removed and nothing is sent.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CleanupOutput, MessageCatalog, MessageId } from "../../../src/contracts/index.js";
import { renderCleanup } from "../../../src/cli/cleanup.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import {
  LEFTOVER,
  NOTHING_REMOVED,
  PLAN_ALL,
  PLAN_DISCARDED,
  PLAN_LEFTOVERS,
  REMOVED,
  RUN_A,
  RUN_B,
  RUN_C,
  RUN_D,
  SHORT,
  preview,
} from "./u34-cleanup-fixtures.js";

type Format = (id: MessageId, params?: Record<string, number>) => string;
const text = (lines: readonly string[]): string => `${lines.join("\n")}\n`;

/** A catalog whose texts are their ids and parameters: `<id {"name":value}>`. */
const standIn = {
  language: "en",
  format: (id: MessageId, params?: Record<string, number>) =>
    `<${id}${params === undefined || Object.keys(params).length === 0 ? "" : ` ${JSON.stringify(params)}`}>`,
} as unknown as MessageCatalog;
const marked: Format = standIn.format as Format;

/** The lines of a preview of PLAN_ALL, with the texts of `f`. */
function planAllLines(f: Format): string[] {
  return [
    f("cleanup.summary.runs", { count: 4, bytes: 4000 }),
    f("cleanup.summary.discarded", { files: 2, bytes: 200 }),
    f("cleanup.summary.parked", { files: 1, bytes: 10 }),
    f("cleanup.summary.leftovers", { count: 1, bytes: 30 }),
    f("cleanup.summary.unknown_folders", { count: 1, bytes: 5 }),
    "",
    f("cleanup.confirm.runs", { count: 3, bytes: 450 }),
    `  ${f("cleanup.confirm.not_reverted", { count: 1 })}`,
    `- ${RUN_A}: ${f("cleanup.size", { files: 3, bytes: 300 })}; ${f("cleanup.warning.not_reverted")}`,
    `- ${RUN_B}: ${f("cleanup.size", { files: 1, bytes: 100 })}; ${f("cleanup.warning.discarded_left")}`,
    `- ${RUN_C}: ${f("cleanup.size", { files: 1, bytes: 50 })}`,
    f("cleanup.confirm.discarded", { files: 2, bytes: 200 }),
    `- ${RUN_B}: ${f("cleanup.size", { files: 2, bytes: 200 })}; ${f("cleanup.warning.people_files")}`,
    f("cleanup.confirm.leftovers", { count: 1, bytes: 30 }),
    `- cleanup-${LEFTOVER}: ${f("cleanup.size", { files: 3, bytes: 30 })}; ${f("cleanup.warning.leftover")}`,
    `- ${f("cleanup.target.run")} ${RUN_D}: ${f("cleanup.blocked.lock_held")}`,
    "",
    `${f("cleanup.next.confirm_runs")} --confirm ${SHORT}.`,
    f("cleanup.next.not_reverted", { count: 1 }),
    f("cleanup.next.discarded"),
    f("cleanup.next.discarded_left", { count: 1 }),
  ];
}

const summaryOf = (lines: readonly string[]): string[] => lines.slice(0, 6);

function cases(f: Format): { readonly name: string; readonly output: CleanupOutput; readonly lines: readonly string[] }[] {
  const all = planAllLines(f);
  return [
    { name: "a preview with every kind of item and a blocked run", output: preview(PLAN_ALL), lines: all },
    {
      name: "a preview with only a discarded-files folder",
      output: preview(PLAN_DISCARDED),
      lines: [
        ...summaryOf(all),
        f("cleanup.confirm.discarded", { files: 2, bytes: 200 }),
        `- ${RUN_B}: ${f("cleanup.size", { files: 2, bytes: 200 })}; ${f("cleanup.warning.people_files")}`,
        `- ${f("cleanup.target.discarded")} ${RUN_D}: ${f("cleanup.blocked.no_result")}`,
        "",
        `${f("cleanup.next.confirm_discarded")} --confirm ${SHORT} --delete-discarded.`,
      ],
    },
    {
      name: "a preview with only a leftover folder",
      output: preview(PLAN_LEFTOVERS),
      lines: [
        ...summaryOf(all),
        f("cleanup.confirm.leftovers", { count: 1, bytes: 30 }),
        `- cleanup-${LEFTOVER}: ${f("cleanup.size", { files: 3, bytes: 30 })}; ${f("cleanup.warning.leftover")}`,
        "",
        `${f("cleanup.next.confirm_leftovers")} --confirm ${SHORT}.`,
      ],
    },
    {
      name: "a confirmed cleanup that removed nothing",
      output: NOTHING_REMOVED,
      lines: [
        f("cleanup.nothing_removed"),
        `- ${f("cleanup.target.run")} ${RUN_A}: ${f("cleanup.kept.not_reverted_not_confirmed")}`,
        `- ${f("cleanup.target.discarded")} ${RUN_B}: ${f("cleanup.kept.not_confirmed")}`,
        `- ${f("cleanup.target.leftover")} cleanup-${LEFTOVER}: ${f("cleanup.kept.partly_removed")}`,
      ],
    },
    {
      name: "a confirmed cleanup that removed some and kept an apply run",
      output: REMOVED,
      lines: [
        f("cleanup.done", { runs: 2, folders: 1, bytes: 550 }),
        f("cleanup.done_leftovers", { count: 1, bytes: 30 }),
        f("cleanup.done_discarded_left", { count: 1 }),
        `- ${f("cleanup.target.run")} ${RUN_B}: ${f("cleanup.kept.discarded_left")}`,
      ],
    },
  ];
}

describe("U-34: every cleanup line a person reads is a catalog text", () => {
  for (const { name, output, lines } of cases(marked)) {
    test(`${name}: the texts by id, the options after them`, () => {
      assert.equal(renderCleanup(output, standIn), text(lines));
    });
  }
});

describe("U-34: a Korean cleanup tells in Korean", () => {
  const korean = createMessageCatalog("ko");
  const ko = korean.format as Format;
  /** The English the renderer wrote itself before U-34. */
  const OLD_ENGLISH = ["Nothing was removed", "file(s)", "bytes;", "run the same command", "People's discarded", "apply run(s)", "run(s) not reverted"];
  cases(marked).forEach(({ name, output }, index) => {
    test(`${name}: the Korean texts, no English of the renderer's own`, () => {
      const shown = renderCleanup(output, korean);
      for (const english of OLD_ENGLISH) assert.equal(shown.includes(english), false, `${english}\n${shown}`);
      for (const line of shown.split("\n")) assert.doesNotMatch(line, /^- (run|discarded|leftover) /, shown);
      // Made here, not when the suite is listed: a text the catalog lacks fails this test only.
      assert.equal(shown, text(cases((id, params) => ko(id, params))[index]?.lines ?? []));
    });
  });
});
