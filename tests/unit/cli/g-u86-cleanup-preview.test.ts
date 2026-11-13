/**
 * U-86 (UXM-10, the rest of UXM-1; PM: nc-human's plan B; contract c0c9933), the CLI's part: the
 * preview listed the run records, the discarded files and the leftovers by kind, though what goes
 * depends on what is given (a "remove 4" list of which --confirm alone removed 1); its warnings ran
 * on one line; its next steps repeated them as long sentences; with nothing selected it said there
 * was nothing to clean up; and the summary did not count the discarded files left without records.
 * Now the preview groups the items by the store's fate for each (CleanupPlan's CLEANUP_ITEM_FATES):
 * --confirm alone, --include-not-reverted besides, --delete-discarded besides (an item that needs
 * both is here), kept with an apply run; one line per warning under its item, which names its kind;
 * then the two commands (--confirm alone; every flag needed), and with nothing selected two example
 * commands. After a confirmation, and in `cleanup --json`, nothing changes.
 * A stand-in catalog shows which text each line is. Made-up outputs; no store is read.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CleanupOutput, MessageCatalog, MessageId } from "../../../src/contracts/index.js";
import { renderCleanup } from "../../../src/cli/cleanup.js";
import { LEFTOVER, PLAN_ALL, PLAN_DISCARDED, PLAN_EMPTY, RUN_A, RUN_B, RUN_C, RUN_D, SHORT, SUMMARY_PLAIN, preview } from "./u34-cleanup-fixtures.js";
import { PLAN_ALL_FATES, PLAN_BOTH, PLAN_KEPT, SUMMARY_RECORDLESS } from "./u86-cleanup-fixtures.js";

type Format = (id: MessageId, params?: Record<string, number>) => string;
const text = (lines: readonly string[]): string => `${lines.join("\n")}\n`;
const standIn = {
  language: "en",
  format: (id: MessageId, params?: Record<string, number>) =>
    `<${id}${params === undefined || Object.keys(params).length === 0 ? "" : ` ${JSON.stringify(params)}`}>`,
} as unknown as MessageCatalog;
const f: Format = standIn.format as Format;
/** renderCleanup with U-86's third argument (whether a selection was given). */
const render = (output: CleanupOutput, selected = true): string =>
  (renderCleanup as unknown as (output: CleanupOutput, messages: MessageCatalog, options: { selected: boolean }) => string)(output, standIn, { selected });

const summaryLines = [
  f("cleanup.summary.runs", { count: 4, bytes: 4000 }),
  f("cleanup.summary.discarded", { files: 2, bytes: 200 }),
  f("cleanup.summary.parked", { files: 1, bytes: 10 }),
  f("cleanup.summary.leftovers", { count: 1, bytes: 30 }),
  f("cleanup.summary.unknown_folders", { count: 1, bytes: 5 }),
];
const item = (target: "run" | "discarded" | "leftover", name: string, files: number, bytes: number): string =>
  `- ${f(`cleanup.target.${target}` as MessageId)} ${name}: ${f("cleanup.size", { files, bytes })}`;
const warning = (code: string): string => `  ${f(`cleanup.warning.${code}` as MessageId)}`;

describe("U-86: the preview groups the items by what must be given for each to go", () => {
  test("every group, a warning per line under its item, the blocked run, then both commands", () => {
    assert.equal(
      render(preview(PLAN_ALL_FATES)),
      text([
        ...summaryLines,
        "",
        f("cleanup.group.confirm", { count: 2, bytes: 80 }),
        item("run", RUN_C, 1, 50),
        item("leftover", `cleanup-${LEFTOVER}`, 3, 30),
        warning("leftover"),
        f("cleanup.group.include_not_reverted", { count: 1, bytes: 300 }),
        item("run", RUN_A, 3, 300),
        warning("not_reverted"),
        f("cleanup.group.delete_discarded", { count: 2, files: 3, bytes: 300 }),
        item("run", RUN_B, 1, 100),
        warning("discarded_left"),
        item("discarded", RUN_B, 2, 200),
        warning("people_files"),
        `- ${f("cleanup.target.run")} ${RUN_D}: ${f("cleanup.blocked.lock_held")}`,
        "",
        `${f("cleanup.command.confirm")} --confirm ${SHORT}`,
        `${f("cleanup.command.all")} --confirm ${SHORT} --include-not-reverted --delete-discarded`,
      ]),
    );
  });

  test("an item that needs both flags is in the --delete-discarded group; its warnings say it was not reverted", () => {
    const shown = render(preview(PLAN_BOTH));
    assert.ok(
      shown.includes(
        text([
          f("cleanup.group.delete_discarded", { count: 2, files: 3, bytes: 30 }),
          item("run", RUN_A, 2, 20),
          warning("not_reverted"),
          warning("discarded_left"),
          item("discarded", RUN_A, 1, 10),
          warning("people_files"),
          "",
          `${f("cleanup.command.all")} --confirm ${SHORT} --include-not-reverted --delete-discarded`,
        ]),
      ),
      shown,
    );
    assert.equal(shown.includes(f("cleanup.command.confirm")), false, "no item goes with --confirm alone");
    assert.equal(shown.includes(f("cleanup.group.include_not_reverted", { count: 0, bytes: 0 })), false);
  });

  test("items no confirmation removes: the kept group with each one's reason", () => {
    const shown = render(preview(PLAN_KEPT));
    assert.ok(
      shown.includes(
        text([
          f("cleanup.group.confirm", { count: 1, bytes: 3 }),
          item("leftover", `cleanup-${LEFTOVER}`, 1, 3),
          warning("leftover"),
          f("cleanup.group.kept", { count: 2 }),
          item("run", RUN_C, 1, 5),
          `  ${f("cleanup.kept.used_by_kept_apply")}`,
          item("run", RUN_B, 1, 7),
          `  ${f("cleanup.kept.discarded_left")}`,
          "",
          `${f("cleanup.command.confirm")} --confirm ${SHORT}`,
        ]),
      ),
      shown,
    );
    assert.equal(shown.includes(f("cleanup.command.all")), false, "no flag removes more");
  });

  test("without the store's fates (an older store): a not-reverted run needs its flag, a folder needs --delete-discarded", () => {
    const shown = render(preview(PLAN_DISCARDED));
    assert.ok(shown.includes(`${f("cleanup.group.delete_discarded", { count: 1, files: 2, bytes: 200 })}\n${item("discarded", RUN_B, 2, 200)}\n`), shown);
    const all = render(preview(PLAN_ALL));
    assert.ok(all.includes(`${f("cleanup.group.include_not_reverted", { count: 1, bytes: 300 })}\n${item("run", RUN_A, 3, 300)}\n`), all);
  });

  test("the summary counts the discarded files left without records", () => {
    const shown = render(preview(PLAN_EMPTY, SUMMARY_RECORDLESS));
    assert.ok(shown.includes(`${f("cleanup.summary.discarded", { files: 2, bytes: 200 })}\n${f("cleanup.summary.discarded_without_records", { count: 1, bytes: 200 })}\n`), shown);
  });

  test("nothing selected: the no-selection line and two example commands; a selection that matched nothing says so as before", () => {
    assert.equal(
      render(preview(PLAN_EMPTY, SUMMARY_PLAIN), false),
      text([
        f("cleanup.summary.runs", { count: 0, bytes: 0 }),
        f("cleanup.summary.discarded", { files: 0, bytes: 0 }),
        f("cleanup.summary.parked", { files: 0, bytes: 0 }),
        "",
        f("cleanup.no_selection"),
        `  ${f("cleanup.example.older_than")}`,
        `  ${f("cleanup.example.reverted")}`,
      ]),
    );
    assert.ok(render(preview(PLAN_EMPTY, SUMMARY_PLAIN), true).endsWith(`\n\n${f("cleanup.nothing")}\n`));
  });
});
