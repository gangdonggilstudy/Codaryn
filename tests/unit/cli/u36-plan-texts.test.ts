/**
 * U-36 (UXM-7 ③ ④; the U-19 survey, section 3 C; contract 1ca962e): the text of `codaryn plan`, the
 * two questions of `apply` at a terminal and `review`'s lines were fixed English, also in a Korean
 * session. They come from the catalog now.
 * - English stays as on main, letter for letter, with the English texts the catalog is to have
 *   (ENGLISH below, nb-i18n's), except two lines (reported):
 *   - plan.applied_by: the apply's time in local wall time in parentheses (UXM-23), in place of
 *     " at <ISO time>.";
 *   - apply.unsafe_move_question: one text for every count, in the catalog's words (nb-i18n 2794d22:
 *     no text may promise a guarantee; c71da18 after review R-66: words that read the same for one
 *     move and for many, the count after a colon).
 * - The layout is the CLI's, not the texts' (PM after 0229b40): plan.digest_label has no colon (the
 *   CLI puts ": " and the digest after it), plan.discard_kept no parentheses (the CLI puts them).
 * - While the catalog does not have a text yet (N-B), the line is main's English, as the U-14 lines.
 * - The JSON is not touched (the text is built only without --json).
 * A stand-in catalog shows which ids and values the CLI asks for. Fake values only.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MESSAGE_LANGUAGES } from "../../../src/contracts/index.js";
import type { CatalogText, ContentHash, MaskedPlanAction, MaskedText, MessageCatalog, PlanOutput, ReviewOutput } from "../../../src/contracts/index.js";
import { applyQuestion, renderPlan, renderReview, unsafeMoveQuestion } from "../../../src/cli/plan-commands.js";
import { formatLocalTime } from "../../../src/cli/human/index.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { MESSAGE_TEXTS } from "../../../src/i18n/catalog.js";

const RUN = "20261113T010203Z-0a1b2c3d";
const APPLY_RUN = "20261113T020304Z-0b1c2d3e";
const AT = "2026-11-13T02:03:05.000Z";
const DIGEST = "ab".repeat(32) as ContentHash;
const NO_KEYS: readonly string[] = [];
const MOVE: MaskedPlanAction = { kind: "move", from: "a.txt" as MaskedText, to: "b/a.txt" as MaskedText, sha256: DIGEST };
const DISCARD: MaskedPlanAction = { kind: "discard", path: "c.txt" as MaskedText, sha256: DIGEST };
const plan = (extra: Partial<PlanOutput> = {}): PlanOutput => ({
  schemaVersion: 1, kind: "plan", runId: RUN, status: "pending", exitCode: 0, digest: DIGEST, actions: [MOVE, DISCARD], inventoryLimitReached: false, appliedBy: null, ...extra,
});
const APPLIED = plan({ status: "applied", actions: [MOVE], inventoryLimitReached: true, appliedBy: { runId: APPLY_RUN, at: AT } });
const MARKED = plan({ actions: [MOVE], recordsChanged: true });
const REVIEW = (replaced: boolean, verdict: "accepted" | "rejected" = "accepted"): ReviewOutput => ({
  schemaVersion: 1, kind: "review", runId: RUN, verdict, exitCode: verdict === "accepted" ? 0 : 1, checklist: ["the table is right" as MaskedText, "the notes match" as MaskedText], replaced,
});

/** The U-36 ids. */
const IDS = [
  "plan.heading", "plan.status.pending", "plan.status.applied", "plan.digest_label", "plan.action.move", "plan.action.discard", "plan.discard_kept",
  "plan.inventory_limit", "plan.applied_by", "plan.next_apply", "apply.question", "apply.unsafe_move_question",
  "review.recorded", "review.recorded_replaced", "review.verdict.accepted", "review.verdict.rejected", "review.unchanged",
];

/** The English the catalog is to have so that English stays as on main (nb-i18n's texts). */
const ENGLISH: { readonly [id: string]: string } = {
  "plan.heading": "Plan of run {runId}: {count} action(s), {status}",
  "plan.status.pending": "pending",
  "plan.status.applied": "applied",
  "plan.digest_label": "Digest",
  "plan.action.move": "move",
  "plan.action.discard": "discard",
  "plan.discard_kept": "kept in .codaryn/discarded/ until removed",
  "plan.inventory_limit": "The workspace has more files than the inventory check can list; an apply would stop as plan_stale and move nothing.",
  "plan.applied_by": "Applied by run {runId}",
  "plan.next_apply": "To apply it: codaryn apply <the same task form> --run {runId} --digest",
  "apply.question": "Apply this plan?",
  "apply.unsafe_move_question":
    "Moves of this plan that could replace a file at the destination, since the drive has no hard links: {count}. Nothing was moved. Apply again and make such moves anyway, for this apply only?",
  "review.recorded": "Review of run {runId}: {verdict}.",
  "review.recorded_replaced": "Review of run {runId}: {verdict} (an earlier review was replaced).",
  "review.verdict.accepted": "accepted",
  "review.verdict.rejected": "rejected",
  "review.unchanged": "The run's result and records are unchanged; `codaryn report` shows the verdict.",
};

const en = createMessageCatalog("en");
const ko = createMessageCatalog("ko");
const asReal = (catalog: MessageCatalog) => catalog.format as (id: string, ...rest: unknown[]) => CatalogText;
/** The real catalog, but the U-36 ids give `<id {params}>`: which ids and values are asked for. */
const marking = (base: MessageCatalog): MessageCatalog => ({
  language: base.language,
  format: ((id: string, ...params: unknown[]) =>
    IDS.includes(id) ? (`<${id}${params[0] === undefined ? "" : ` ${JSON.stringify(params[0])}`}>` as CatalogText) : asReal(base)(id, ...params)) as MessageCatalog["format"],
});
/** The real English catalog with ENGLISH for the U-36 ids. */
const english: MessageCatalog = {
  language: "en",
  format: ((id: string, ...params: unknown[]) => {
    const text = ENGLISH[id];
    if (text === undefined) return asReal(en)(id, ...params);
    const values = (params[0] ?? {}) as Record<string, unknown>;
    return text.replace(/\{([A-Za-z]+)\}/g, (_whole, name: string) => String(values[name])) as CatalogText;
  }) as MessageCatalog["format"],
};

/** main's English (0ad28bc..ae4021d): the U-14 lines from the catalog, the rest fixed. */
const MAIN = {
  pending: [
    `Plan of run ${RUN}: 2 action(s), pending`,
    `Digest: ${DIGEST}`,
    "  1. move     a.txt  ->  b/a.txt",
    "  2. discard  c.txt  (kept in .codaryn/discarded/ until removed)",
    `${en.format("plan.summary_label")}:`,
    "  | sort the notes",
    `To apply it: codaryn apply <the same task form> --run ${RUN} --digest ${DIGEST.slice(0, 12)}`,
    en.format("plan.digest_guarantee"),
  ],
  marked: [
    en.format("plan.records_changed"),
    `Plan of run ${RUN}: 1 action(s), pending`,
    `Digest: ${DIGEST}`,
    "  1. move     a.txt  ->  b/a.txt",
    en.format("plan.cannot_apply"),
    en.format("plan.digest_guarantee"),
  ],
  applied: [
    `Plan of run ${RUN}: 1 action(s), applied`,
    `Digest: ${DIGEST}`,
    "  1. move     a.txt  ->  b/a.txt",
    "The workspace has more files than the inventory check can list; an apply would stop as plan_stale and move nothing.",
    `Applied by run ${APPLY_RUN} at ${AT}.`,
    en.format("plan.digest_guarantee"),
  ],
  question: "Apply this plan? [y/N] ",
  unsafe1: "1 move of this plan can only be made without the guarantee that nothing at the destination is replaced (the drive has no hard links). Nothing was moved. Apply again and make it anyway, for this apply only? [y/N] ",
  unsafe3: "3 moves of this plan can only be made without the guarantee that nothing at the destination is replaced (the drive has no hard links). Nothing was moved. Apply again and make them anyway, for this apply only? [y/N] ",
  review: [`Review of run ${RUN}: accepted.`, "  1. the table is right", "  2. the notes match", "The run's result and records are unchanged; `codaryn report` shows the verdict."],
  reviewReplaced: `Review of run ${RUN}: rejected (an earlier review was replaced).`,
};
const text = (lines: readonly string[]): string => `${lines.join("\n")}\n`;
const PENDING = plan({ summary: "sort the notes" as MaskedText });
/** The new form of the applied line (UXM-23): local wall time in parentheses. */
const appliedLine = (catalog: MessageCatalog): string => `${asReal(catalog)("plan.applied_by", { runId: APPLY_RUN })} (${formatLocalTime(Date.parse(AT))})`;

describe("U-36: the plan view, apply's questions and review's lines come from the catalog", () => {
  const marked = marking(ko);

  test("the plan view asks for every line of its own (heading, status, digest label, actions, discard, next command)", () => {
    const lines = renderPlan(plan(), NO_KEYS, marked).trimEnd().split("\n");
    const width = Math.max(...["<plan.action.move>", "<plan.action.discard>"].map((word) => word.length)) + 2;
    assert.deepEqual(lines.slice(0, 4), [
      `<plan.heading ${JSON.stringify({ runId: RUN, count: 2, status: "<plan.status.pending>" })}>`,
      `<plan.digest_label>: ${DIGEST}`,
      `  1. ${"<plan.action.move>".padEnd(width)}a.txt  ->  b/a.txt`,
      `  2. ${"<plan.action.discard>".padEnd(width)}c.txt  (<plan.discard_kept>)`,
    ]);
    assert.equal(lines.at(-2), `<plan.next_apply ${JSON.stringify({ runId: RUN })}> ${DIGEST.slice(0, 12)}`);
    assert.equal(lines.at(-1), ko.format("plan.digest_guarantee"));
  });

  test("an applied plan: its status, the inventory limit, and who applied it with the local time; no next command", () => {
    const lines = renderPlan(APPLIED, NO_KEYS, marked).trimEnd().split("\n");
    assert.equal(lines[0], `<plan.heading ${JSON.stringify({ runId: RUN, count: 1, status: "<plan.status.applied>" })}>`);
    assert.ok(lines.includes("<plan.inventory_limit>"), lines.join("\n"));
    assert.ok(lines.includes(`<plan.applied_by ${JSON.stringify({ runId: APPLY_RUN })}> (${formatLocalTime(Date.parse(AT))})`), lines.join("\n"));
    assert.equal(lines.some((line) => line.startsWith("<plan.next_apply")), false);
  });

  test("an applied time that is not a run timestamp is left out (N-24 (c))", () => {
    const lines = renderPlan({ ...APPLIED, appliedBy: { runId: APPLY_RUN, at: "yesterday" } }, NO_KEYS, marked).trimEnd().split("\n");
    assert.ok(lines.includes(`<plan.applied_by ${JSON.stringify({ runId: APPLY_RUN })}>`), lines.join("\n"));
  });

  test("apply's two questions: the catalog's question, then its [y/N] text", () => {
    assert.equal(applyQuestion(marked), `<apply.question> ${ko.format("prompt.yes_no_default_no")} `);
    assert.equal(unsafeMoveQuestion(3, marked), `<apply.unsafe_move_question ${JSON.stringify({ count: 3 })}> ${ko.format("prompt.yes_no_default_no")} `);
  });

  test("review: the verdict's words in the recorded line, replaced or not; the checklist as before; the closing line", () => {
    assert.deepEqual(renderReview(REVIEW(false), NO_KEYS, marked).trimEnd().split("\n"), [
      `<review.recorded ${JSON.stringify({ runId: RUN, verdict: "<review.verdict.accepted>" })}>`,
      "  1. the table is right",
      "  2. the notes match",
      "<review.unchanged>",
    ]);
    assert.equal(renderReview(REVIEW(true, "rejected"), NO_KEYS, marked).split("\n")[0], `<review.recorded_replaced ${JSON.stringify({ runId: RUN, verdict: "<review.verdict.rejected>" })}>`);
  });

  test("the action words are padded to the widest one in terminal columns, as the English is", () => {
    const wide: MessageCatalog = {
      language: "ko",
      format: ((id: string, ...params: unknown[]) =>
        id === "plan.action.move" ? ("옮김" as CatalogText) : id === "plan.action.discard" ? ("폐기 보관" as CatalogText) : asReal(marked)(id, ...params)) as MessageCatalog["format"],
    };
    const lines = renderPlan(plan(), NO_KEYS, wide).split("\n");
    // 옮김: 4 columns, 폐기 보관: 9 columns; both then take 11.
    assert.equal(lines[2], "  1. 옮김       a.txt  ->  b/a.txt");
    assert.equal(lines[3], "  2. 폐기 보관  c.txt  (<plan.discard_kept>)");
  });
});

describe("U-36: English stays as on main", () => {
  test("with the English texts the catalog is to have: the plan view letter for letter (the applied line in its new form)", () => {
    assert.equal(renderPlan(PENDING, NO_KEYS, english), text(MAIN.pending));
    assert.equal(renderPlan(MARKED, NO_KEYS, english), text(MAIN.marked));
    assert.equal(renderPlan(APPLIED, NO_KEYS, english), text(MAIN.applied.map((line) => (line.startsWith("Applied by run") ? appliedLine(english) : line))));
    assert.equal(appliedLine(english), `Applied by run ${APPLY_RUN} (${formatLocalTime(Date.parse(AT))})`);
  });

  test("with those texts: apply's question and review as on main; the unsafe-move question as the catalog says it", () => {
    assert.equal(applyQuestion(english), MAIN.question);
    assert.equal(renderReview(REVIEW(false), NO_KEYS, english), text(MAIN.review));
    assert.equal(renderReview(REVIEW(true, "rejected"), NO_KEYS, english).split("\n")[0], MAIN.reviewReplaced);
    assert.equal(
      unsafeMoveQuestion(1, english),
      "Moves of this plan that could replace a file at the destination, since the drive has no hard links: 1. Nothing was moved. Apply again and make such moves anyway, for this apply only? [y/N] ",
    );
  });

  test("while the catalog does not have a text (or without one): main's English, every line", () => {
    const none: MessageCatalog = { language: "ko", format: ((id: string, ...params: unknown[]) => (IDS.includes(id) ? (() => { throw new Error("unknown message id"); })() : asReal(en)(id, ...params))) as MessageCatalog["format"] };
    assert.equal(renderPlan(PENDING, NO_KEYS, none), text(MAIN.pending));
    assert.equal(renderPlan(APPLIED, NO_KEYS, none), text(MAIN.applied));
    assert.equal(applyQuestion(none), MAIN.question);
    assert.equal(applyQuestion(undefined), MAIN.question);
    assert.equal(unsafeMoveQuestion(1, none), MAIN.unsafe1);
    assert.equal(unsafeMoveQuestion(3, undefined), MAIN.unsafe3);
    assert.equal(renderReview(REVIEW(false), NO_KEYS, undefined), text(MAIN.review));
    assert.equal(renderReview(REVIEW(true, "rejected"), NO_KEYS, none).split("\n")[0], MAIN.reviewReplaced);
  });
});

describe("U-36 with the real catalog", () => {
  const ready = MESSAGE_LANGUAGES.every((language) => IDS.every((id) => Object.hasOwn(MESSAGE_TEXTS[language], id)));
  const skip = ready ? false : "the U-36 texts are not in the catalog yet (nb-i18n)";

  test("English: the catalog's texts are those English needs", { skip }, () => {
    for (const id of IDS) assert.equal((MESSAGE_TEXTS.en as Record<string, string>)[id], ENGLISH[id], id);
    assert.equal(renderPlan(PENDING, NO_KEYS, en), text(MAIN.pending));
    assert.equal(renderPlan(MARKED, NO_KEYS, en), text(MAIN.marked));
    assert.equal(applyQuestion(en), MAIN.question);
    assert.equal(renderReview(REVIEW(false), NO_KEYS, en), text(MAIN.review));
  });

  test("Korean: none of main's fixed English is left, and the lines differ from English", { skip }, () => {
    const shown = [renderPlan(PENDING, NO_KEYS, ko), renderPlan(APPLIED, NO_KEYS, ko), applyQuestion(ko), unsafeMoveQuestion(2, ko), renderReview(REVIEW(true), NO_KEYS, ko)].join("\n");
    for (const english of ["Plan of run", "action(s)", "Digest:", "kept in .codaryn", "inventory check", "Applied by run", "To apply it", "Apply this plan?", "can only be made without", "Review of run", "records are unchanged"]) {
      assert.equal(shown.includes(english), false, english);
    }
    assert.match(shown, /\p{Script=Hangul}/u);
  });
});
