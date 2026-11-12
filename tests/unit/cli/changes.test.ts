/**
 * DR-7, DR-14: `codaryn changes` (src/cli/changes.ts): arguments, the text and JSON forms, errors,
 * and one run through the real app layer with a scripted model. Fake values only, no network.
 * U-36 (UXM-7 ③, survey docs/reviews/2026-11-13-u19-korean-gaps-survey.md 3 D): the text comes from the
 * message catalog (the contract's ids, U-36 contract 1ca962e); see the U-36 sections at the end.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { ANTHROPIC_API_KEY_ENV } from "../../../src/contracts/index.js";
import type { CliErrorOutput, EngineResult, MessageCatalog } from "../../../src/contracts/index.js";
import { createCodarynApp } from "../../../src/app/index.js";
import type { AppCallOutcome, ChangesOutput, ChangesRequest, RunHandle } from "../../../src/app/index.js";
import { CHANGES_USAGE, MAX_SHOWN_LINES, changedRegion, parseChangesArgs, renderChanges, runChanges } from "../../../src/cli/changes.js";
import type { CommandOutcome } from "../../../src/cli/guard.js";
import { createMessageCatalog } from "../../../src/i18n/index.js";
import { FAKE_SECRET, WRITE_NOTES, appEnvironment, setupRun, taskRequest } from "../app/support.js";

const FAKE_KEY = "fake-changes-key-value-0083";

function text(outcome: CommandOutcome): string {
  assert.ok("text" in outcome, JSON.stringify(outcome));
  return outcome.text;
}

function errorOf(outcome: CommandOutcome): CliErrorOutput {
  assert.ok("output" in outcome && outcome.output.kind === "error", JSON.stringify(outcome));
  return outcome.output as CliErrorOutput;
}

const VIEW: ChangesOutput = {
  schemaVersion: 1,
  kind: "changes",
  runId: "20261112T010203Z-0a1b2c3d",
  exitCode: 0,
  masking: "current_secrets",
  files: [
    { path: "README.md" as never, created: false, state: "as_run_left", before: "a\nb\nc\n" as never, after: "a\nB\nb2\nc\n" as never, unavailable: null },
    { path: "NOTES.md" as never, created: true, state: "changed_since_run", before: null, after: "# Notes\n" as never, unavailable: null },
    { path: "gone.md" as never, created: false, state: "missing", before: "x\n" as never, after: null, unavailable: null },
    { path: "bin.dat" as never, created: false, state: "as_run_left", before: null, after: null, unavailable: "not_text" },
  ],
};

function fakeApp(outcome: AppCallOutcome<ChangesOutput>): { app: { changes(request: ChangesRequest): Promise<AppCallOutcome<ChangesOutput>> }; seen: ChangesRequest[] } {
  const seen: ChangesRequest[] = [];
  return {
    seen,
    app: {
      async changes(request) {
        seen.push(request);
        return outcome;
      },
    },
  };
}

describe("parseChangesArgs", () => {
  test("takes the task form and a run id or latest", () => {
    const task = parseChangesArgs(["changes", "--task", "t.json", "--config", "c.json", "--vars-file", "v.env", "--run", "latest", "--json"]);
    assert.deepEqual(task, {
      ok: true,
      args: {
        command: "changes",
        settings: { input: { kind: "task", taskPath: "t.json" }, configPath: "c.json", varsFile: "v.env", profile: null, workflowRef: null },
        runId: "latest",
        json: true,
      },
    });
    const quick = parseChangesArgs(["changes", "--workspace", "w", "--profile", "doc", "--run", "20261112T010203Z-0a1b2c3d"]);
    assert.ok(quick.ok);
    assert.deepEqual(quick.args.settings.input, { kind: "workspace", workspace: "w" });
    assert.deepEqual([quick.args.settings.profile, quick.args.json], ["doc", false]);
  });

  test("refuses missing, combined, repeated, unknown and flag-like values, and Node's env-file names", () => {
    const refused = (argv: readonly string[]) => {
      const outcome = parseChangesArgs(argv);
      assert.equal(outcome.ok, false, argv.join(" "));
      return (outcome as { message: string }).message;
    };
    // U-17 (UXM-19, DR-46): with neither, the current directory is the workspace (g-u17-read-commands).
    assert.match(refused(["changes", "--task", "t", "--workspace", "w", "--run", "latest"]), /either --task or --workspace/);
    assert.match(refused(["changes", "--task", "t", "--profile", "p", "--run", "latest"]), /--profile goes with --workspace/);
    assert.match(refused(["changes", "--task", "t"]), /--run is required/);
    assert.match(refused(["changes", "--task", "t", "--run", "../x"]), /--run must be a run id/);
    assert.match(refused(["changes", "--task", "t", "--run", "latest", "--run", "latest"]), /unknown or repeated/);
    assert.match(refused(["changes", "--task", "--json", "--run", "latest"]), /--task needs a value/);
    assert.match(refused(["changes", "--task", "t", "--run", "latest", "--quiet"]), /unknown or repeated/);
    assert.match(refused(["changes", "--task", "t", "--run", "latest", "--env-file=x"]), /--vars-file/);
    assert.equal(refused(["report", "--task", "t"]), CHANGES_USAGE);
  });
});

describe("changedRegion and renderChanges", () => {
  test("show the lines between the common first and last lines, as - and +", () => {
    assert.deepEqual(changedRegion("a\nb\nc\n", "a\nB\nb2\nc\n"), ["@@ -2,1 +2,2 @@", "- b", "+ B", "+ b2"]);
    assert.deepEqual(changedRegion(null, "x\n"), ["@@ -1,0 +1,1 @@", "+ x"]);
    assert.deepEqual(changedRegion("x\r\n", "x\n"), [], "a line ending change alone is not shown");
    const long = Array.from({ length: MAX_SHOWN_LINES + 5 }, (_value, index) => `l${index}`).join("\n");
    const region = changedRegion(null, long);
    assert.equal(region.at(-1), "+ ... 5 more lines");
  });

  test("the text form names each file's state and replaces control characters", () => {
    const shown = renderChanges({ ...VIEW, files: [...VIEW.files, { ...VIEW.files[0]!, path: "evil\u001b[2J.md" as never, after: "a\nb\u0007\nc\n" as never }] });
    assert.match(shown, /^changes of run 20261112T010203Z-0a1b2c3d, masked with the secrets registered now/);
    assert.match(shown, /== README\.md: changed by the run; as the run left it\n@@ -2,1 \+2,2 @@\n- b\n\+ B\n\+ b2/);
    assert.match(shown, /== NOTES\.md: created by the run; changed again since the run\n@@ -1,0 \+1,1 @@\n\+ # Notes/);
    assert.match(shown, /== gone\.md: changed by the run; no longer exists\n@@ -1,1 \+1,0 @@\n- x/);
    assert.match(shown, /== bin\.dat: changed by the run; as the run left it\n {3}the text is not shown \(not_text\)/);
    assert.equal(/[\u0000-\u0008\u000b-\u001f\u007f]/.test(shown), false, "no control character but line feeds");
    assert.match(renderChanges({ ...VIEW, files: [] }), /the run changed no file/);
  });

  // U-16 (UXM-4): an apply run's moves and discards are its plan's actions, not file writes of its
  // own; its view says what it applied (changes.apply_run) instead of "no file changed".
  test("an apply run's text says which plan run it applied and how many actions, not no file", () => {
    const view: ChangesOutput = { ...VIEW, files: [], applyRun: { planRunId: "20261112T010000Z-0f0e0d0c" as never, actions: 3 } };
    const shown = renderChanges(view);
    assert.doesNotMatch(shown, /the run changed no file/);
    assert.match(shown, /20261112T010000Z-0f0e0d0c/);
    assert.match(shown, /\b3\b/);
  });
});

describe("runChanges", () => {
  test("passes the parsed request to the app layer and prints JSON or text, hiding the current key", async () => {
    const withKey: ChangesOutput = { ...VIEW, files: [{ ...VIEW.files[0]!, after: `a\nkey ${FAKE_KEY}\nc\n` as never }] };
    const fake = fakeApp({ ok: true, output: withKey });
    const env = { [ANTHROPIC_API_KEY_ENV]: FAKE_KEY };
    const json = await runChanges({ argv: ["changes", "--task", "t.json", "--run", "latest", "--json"], env, app: fake.app });
    assert.equal(json.exitCode, 0);
    const printed = text(json);
    assert.equal(printed.endsWith("\n") && printed.split("\n").length, 2, "one JSON line");
    assert.equal(printed.includes(FAKE_KEY), false);
    assert.equal((JSON.parse(printed) as ChangesOutput).kind, "changes");
    assert.deepEqual(fake.seen[0], { settings: { input: { kind: "task", taskPath: "t.json" }, configPath: null, varsFile: null, profile: null, workflowRef: null }, runId: "latest" });

    const human = text(await runChanges({ argv: ["changes", "--task", "t.json", "--run", "latest"], env, app: fake.app }));
    assert.equal(human.includes(FAKE_KEY), false);
  });

  test("errors are the CLI's error line with the app's code and exit code", async () => {
    const fake = fakeApp({ ok: false, error: { code: "secret_env_missing", message: "privacy.secretEnv[0] is not set" } });
    const error = errorOf(await runChanges({ argv: ["changes", "--task", "t.json", "--run", "latest"], env: {}, app: fake.app }));
    assert.deepEqual([error.kind, error.code, error.exitCode], ["error", "secret_env_missing", 2]);
    const bad = errorOf(await runChanges({ argv: ["changes", "--task", "t.json"], env: {}, app: fake.app }));
    assert.deepEqual([bad.code, fake.seen.length], ["invalid_arguments", 1]);
  });

  /** A scripted run through the real app layer that registered FAKE_SECRET, changed README.md (which holds it) and created NOTES.md. */
  async function realRun(): Promise<string> {
    const original = `# Title\nkey ${FAKE_SECRET}\n`;
    const hash = createHash("sha256").update(Buffer.from(original, "utf8")).digest("hex");
    const base = await setupRun({ "README.md": original }, {}, [
      { toolCalls: [{ name: "write_file", args: { path: "README.md", expectedHash: hash, change: { kind: "replace_text", oldText: "# Title\n", newText: "# Title\n\nadded\n" } } }] },
      WRITE_NOTES,
      { text: "done" },
    ]);
    const app = createCodarynApp(await appEnvironment(base));
    const started = await app.startRun(taskRequest(base));
    assert.equal(started.ok, true);
    const outcome = await (started as { handle: RunHandle }).handle.done;
    assert.equal((outcome as { result: EngineResult }).result.status, "done");
    return base;
  }

  test("with the real app layer and the run's own secrets: each file's changed region, masked, with no secret printed (DR-29)", async () => {
    const base = await realRun();
    const app = createCodarynApp(await appEnvironment(base));
    const shown = text(await runChanges({ argv: ["changes", "--task", path.join(base, "task.json"), "--run", "latest"], env: {}, app }));
    assert.match(shown, /== README\.md: changed by the run; as the run left it\n@@ -2,0 \+2,2 @@\n\+ \n\+ added\n/);
    assert.match(shown, /== NOTES\.md: created by the run; as the run left it\n@@ -1,0 \+1,1 @@\n\+ # Notes\n/);
    assert.equal(shown.includes("masking_unverified"), false);
    assert.equal(shown.includes(FAKE_SECRET), false);
  });

  test("with the real app layer and other secrets than the run's: no text for the file that holds the secret (R-11, DR-29)", async () => {
    const base = await realRun();
    const task = JSON.parse(await readFile(path.join(base, "task.json"), "utf8")) as Record<string, unknown>;
    await writeFile(path.join(base, "other.json"), JSON.stringify({ ...task, privacy: { secretEnv: [] } }), "utf8");
    const app = createCodarynApp(await appEnvironment(base, { env: {} }));
    const shown = text(await runChanges({ argv: ["changes", "--task", path.join(base, "other.json"), "--run", "latest"], env: {}, app }));
    // The reason is given once; the file without text has its path, its state and its own mark
    // (the app layer's finding: one result can hold files with and without text).
    assert.equal(shown.split("(DR-29)\n").length, 2, shown);
    assert.match(shown, /== README\.md: changed by the run; as the run left it\n {3}the text is not shown \(masking_unverified\)\n== NOTES\.md/);
    // NOTES.md holds no secret: either set of secrets leaves the same text visible.
    assert.match(shown, /== NOTES\.md: created by the run; as the run left it\n@@ -1,0 \+1,1 @@\n\+ # Notes\n/);
    assert.equal(shown.includes(FAKE_SECRET), false);
  });
});

// ---------------------------------------------------------------------------------------------
/**
 * Unit U-36 (UXM-7 ③, survey docs/reviews/2026-11-13-u19-korean-gaps-survey.md 3 D), the `changes`
 * part: the text of `codaryn changes` comes from the message catalog (the contract's ids, U-36
 * contract 1ca962e), so a person reads it in their language. Pinned:
 * - English without a catalog (the fallback): the text before U-36 character for character. The
 *   no-text line keeps "(DR-29)", as the English catalog and g-changes-wire keep it (the Korean
 *   leaves it out), so the PM's exception is not used.
 * - English with the English catalog: the same, but for the lines the PM accepted otherwise (U-36,
 *   after ENGLISH_TODO): `changes.apply_run`'s sentence and the reason words of
 *   `changes.unavailable.<reason>` (all but masking_unverified). They are pinned here as they are.
 * - `changes --json` is not changed.
 * - With a catalog every piece of text is the catalog's: no fixed English word is left.
 * - A run with a records-changed mark (ChangesOutput.recordsChanged, U-43) says so with the catalog's
 *   `changes.records_changed`, which nothing used before.
 * Reproduced first (e4865d6, todo, in u36-changes-texts.test.ts, moved here to stay in this owner's
 * file); the renderer takes the catalog now, with unit/U-36-nb-i18n's texts (2794d22, ea6b7c1). The
 * English catalog case was todo for a PM question (ENGLISH_TODO); the PM accepted the catalog's
 * English. Fake values only.
 */

const RUN = "20261113T010203Z-0123abcd";
const BASE = { schemaVersion: 1, kind: "changes", runId: RUN, exitCode: 0, masking: "current_secrets" } as const;
const BIG = Array.from({ length: 203 }, (_, i) => `line ${i}`).join("\n") + "\n";

/** Every line kind: created, changed, missing, unreadable, masking_unverified, no difference, a cut side. */
const ALL: ChangesOutput = {
  ...BASE,
  files: [
    { path: "new.md" as never, created: true, state: "as_run_left", before: null, after: "a\nb\n" as never, unavailable: null },
    { path: "doc.md" as never, created: false, state: "changed_since_run", before: "x\ny\n" as never, after: "x\nY\n" as never, unavailable: null },
    { path: "gone.md" as never, created: false, state: "missing", before: "z\n" as never, after: null, unavailable: null },
    { path: "odd.bin" as never, created: false, state: "unknown", before: null, after: null, unavailable: "unreadable" },
    { path: "secret.md" as never, created: false, state: "as_run_left", before: null, after: null, unavailable: "masking_unverified" },
    { path: "same.md" as never, created: false, state: "as_run_left", before: "s\n" as never, after: "s\n" as never, unavailable: null },
    { path: "big.md" as never, created: true, state: "as_run_left", before: null, after: BIG as never, unavailable: null },
  ],
};
const NONE: ChangesOutput = { ...BASE, files: [] };
const APPLY: ChangesOutput = { ...BASE, files: [], applyRun: { planRunId: "20261113T000000Z-89abcdef" as never, actions: 2 } };
const MARKED: ChangesOutput = { ...ALL, files: [ALL.files[4]!], recordsChanged: true };

const HEADING = `changes of run ${RUN}, masked with the secrets registered now (not the run's own masking)`;
/** The English text before U-36 (main 1e54ca9). */
const ALL_EN = [
  HEADING,
  "no text for some files: a file's text is shown only when the secrets registered now mask it as the run did and the file is as the run left it; the others have their path and state only (DR-29)",
  "== new.md: created by the run; as the run left it",
  "@@ -1,0 +1,2 @@",
  "+ a",
  "+ b",
  "== doc.md: changed by the run; changed again since the run",
  "@@ -2,1 +2,1 @@",
  "- y",
  "+ Y",
  "== gone.md: changed by the run; no longer exists",
  "@@ -1,1 +1,0 @@",
  "- z",
  "== odd.bin: changed by the run; could not be read now",
  "   the text is not shown (unreadable)",
  "== secret.md: changed by the run; as the run left it",
  "   the text is not shown (masking_unverified)",
  "== same.md: changed by the run; as the run left it",
  "   no difference to the original",
  "== big.md: created by the run; as the run left it",
  "@@ -1,0 +1,203 @@",
  ...Array.from({ length: 200 }, (_, i) => `+ line ${i}`),
  "+ ... 3 more lines",
  "",
].join("\n");
const NONE_EN = `${HEADING}\nthe run changed no file\n`;
const APPLY_EN = `${HEADING}\nthe run is an apply run: it applied 2 action(s) of the plan of run 20261113T000000Z-89abcdef (moves and discards, not file writes); codaryn report lists them\n`;

/** The PM's decision (U-36): the English catalog's lines that differ from the text before U-36. */
const ALL_EN_CATALOG = ALL_EN.replace("   the text is not shown (unreadable)", "   the text is not shown: the file could not be read (unreadable)");
const APPLY_EN_CATALOG = `${HEADING}\nThis run applied the plan of run 20261113T000000Z-89abcdef; actions applied: 2. They are moves and discards of that plan, not files this run wrote, so no file text is shown here; the run's report lists them.\n`;
const REASONS = ["masked_path", "snapshot_missing", "not_text", "too_large", "unreadable", "mask_failed", "masking_unverified"] as const;
/** Every reason a file's text is not shown, one file each. */
const UNAVAILABLE: ChangesOutput = {
  ...BASE,
  files: REASONS.map((reason, index) => ({ path: `f${index}.md` as never, created: false, state: "as_run_left" as const, before: null, after: null, unavailable: reason })),
};
/** Each reason's line: before U-36 (the fallback), and with the English catalog. */
const UNAVAILABLE_LINES: readonly (readonly [string, string])[] = [
  ["   the text is not shown (masked_path)", "   the text is not shown: its recorded path has a masked part (masked_path)"],
  ["   the text is not shown (snapshot_missing)", "   the text is not shown: no usable copy of the original was kept (snapshot_missing)"],
  ["   the text is not shown (not_text)", "   the text is not shown: the original or the file now is not UTF-8 text (not_text)"],
  ["   the text is not shown (too_large)", "   the text is not shown: the file is too large (too_large)"],
  ["   the text is not shown (unreadable)", "   the text is not shown: the file could not be read (unreadable)"],
  ["   the text is not shown (mask_failed)", "   the text is not shown: it could not be masked (mask_failed)"],
  ["   the text is not shown (masking_unverified)", "   the text is not shown (masking_unverified)"],
];
const reasonLines = (shown: string): string[] => shown.split("\n").filter((line) => line.startsWith("   the text is not shown"));

/** Every fixed English word of the text before U-36. */
const ENGLISH = [
  "changes of run",
  "masked with the secrets",
  "no text for some files",
  "created by the run",
  "changed by the run",
  "as the run left it",
  "changed again since the run",
  "no longer exists",
  "could not be read now",
  "the text is not shown",
  "no difference to the original",
  "more lines",
  "the run changed no file",
  "the run is an apply run",
  "records-changed mark",
];

/** A catalog whose every text names its id (and its parameters), so a text not from it shows. */
const NAMING = {
  language: "en",
  format: (id: string, params?: Readonly<Record<string, unknown>>) => `‹${id}${params === undefined ? "" : ` ${JSON.stringify(params)}`}›`,
} as unknown as MessageCatalog;

describe("U-36: changes' English text is as before", () => {
  test("without a catalog: as before, character for character", () => {
    assert.equal(renderChanges(ALL), ALL_EN);
  });

  test("without a catalog: no file changed, and an apply run, as before", () => {
    assert.equal(renderChanges(NONE), NONE_EN);
    assert.equal(renderChanges(APPLY), APPLY_EN);
  });

  test("with the English catalog: the same text but the lines the PM accepted otherwise (apply run, the reasons)", () => {
    const en = createMessageCatalog("en");
    // Not vacuous: the renderer falls back to English when the catalog refuses an id.
    for (const id of ["changes.none", "changes.no_text_note", "changes.state.missing", "changes.unavailable.unreadable"] as const) assert.doesNotThrow(() => en.format(id), id);
    assert.equal(renderChanges(ALL, en), ALL_EN_CATALOG);
    assert.equal(renderChanges(NONE, en), NONE_EN);
    assert.equal(renderChanges(APPLY, en), APPLY_EN_CATALOG);
    assert.deepEqual(reasonLines(renderChanges(UNAVAILABLE, en)), UNAVAILABLE_LINES.map(([, catalog]) => catalog));
  });

  test("without a catalog: each reason's line as before U-36", () => {
    assert.deepEqual(reasonLines(renderChanges(UNAVAILABLE)), UNAVAILABLE_LINES.map(([before]) => before));
  });

  test("changes --json is not changed", async () => {
    const outcome = await runChanges({
      argv: ["changes", "--task", "t.json", "--run", RUN, "--json"],
      env: {},
      app: { changes: async (_request: ChangesRequest): Promise<AppCallOutcome<ChangesOutput>> => ({ ok: true, output: ALL }) },
    });
    assert.ok("text" in outcome);
    assert.equal(outcome.text, `${JSON.stringify(ALL)}\n`);
  });
});

describe("U-36: with a catalog every piece of changes' text is the catalog's", () => {
  test("each line: the catalog's ids, the masked paths, the region, the reason codes", () => {
    const shown = renderChanges(ALL, NAMING);
    for (const word of ENGLISH) assert.equal(shown.includes(word), false, `fixed English left: ${word}`);
    const lines = shown.split("\n");
    assert.equal(lines[0], `‹changes.heading {"runId":"${RUN}"}›`);
    assert.equal(lines[1], "‹changes.no_text_note›");
    assert.ok(lines.includes("== gone.md: ‹changes.file.changed›; ‹changes.state.missing›"));
    assert.ok(lines.includes("== new.md: ‹changes.file.created›; ‹changes.state.as_run_left›"));
    assert.ok(lines.includes("   ‹changes.unavailable.unreadable› (unreadable)"));
    assert.ok(lines.includes("   ‹changes.no_difference›"));
    assert.ok(lines.includes('+ ‹changes.more_lines {"count":3}›'));
    assert.equal(renderChanges(NONE, NAMING).split("\n")[1], "‹changes.none›");
    assert.equal(renderChanges(APPLY, NAMING).split("\n")[1], '‹changes.apply_run {"count":2,"runId":"20261113T000000Z-89abcdef"}›');
  });

  test("runChanges gives the text its catalog", async () => {
    const outcome = await runChanges({
      argv: ["changes", "--task", "t.json", "--run", RUN],
      env: {},
      app: { changes: async (): Promise<AppCallOutcome<ChangesOutput>> => ({ ok: true, output: NONE }) },
      messages: NAMING,
    });
    assert.ok("text" in outcome);
    assert.equal(outcome.text, `‹changes.heading {"runId":"${RUN}"}›\n‹changes.none›\n`);
  });

  test("with the Korean catalog: no fixed English word", () => {
    const shown = [ALL, NONE, APPLY, MARKED].map((output) => renderChanges(output, createMessageCatalog("ko"))).join("\n");
    for (const word of ENGLISH) assert.equal(shown.includes(word), false, `English left: ${word}`);
  });
});

describe("U-36: a run with a records-changed mark says so (changes.records_changed)", () => {
  test("after the heading, before the no-text line; only for a marked run", () => {
    const lines = renderChanges(MARKED, NAMING).split("\n");
    assert.deepEqual(lines.slice(0, 3), [`‹changes.heading {"runId":"${RUN}"}›`, "‹changes.records_changed›", "‹changes.no_text_note›"]);
    assert.equal(renderChanges(ALL, NAMING).includes("changes.records_changed"), false);
    assert.equal(renderChanges(MARKED).split("\n")[1], "This run has a records-changed mark, so no file text is shown; only paths and states.");
  });
});
