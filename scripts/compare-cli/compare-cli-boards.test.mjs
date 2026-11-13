// U-130: the tests of scripts/compare-cli-boards.mjs.
// Run: node --test scripts/compare-cli/compare-cli-boards.test.mjs
// - normalization and line diff on their own (fast);
// - two real builds of HEAD (git archive, built in a temporary folder): the same build compared
//   with itself over every case (terminal ones too) has no difference, and a build with two
//   catalog lines changed (the English "turn {turn}" progress line and the apply question) is found
//   exactly there: the English run's stderr lines that use the first, the terminal apply's question
//   line (U-135), and nothing else (the Korean case and the apply with --digest are the same).
// Scripted models only; nothing leaves the machine. The temporary folder is removed at the end.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { compareBuilds, prepareBoard, reportOf } from "../compare-cli-boards.mjs";
import { CASES } from "./cases.mjs";
import { compareSides, diffLines, normalizeSide, pathForms } from "./normalize.mjs";

const BACKSLASH = String.fromCharCode(92);
const HEX = (char) => char.repeat(64);

describe("normalizeSide", () => {
  test("run ids, privacy tokens and plan digests are named by first appearance; other hashes stay", () => {
    const side = (run1, run2, token, digest) =>
      normalizeSide([
        { key: "step 1 | stdout", text: `{"runId":"${run1}","plan":{"digest":"${digest}"},"sha256":"${HEX("c")}"}` },
        { key: `file .codaryn/runs/${run1}/journal.jsonl`, text: `{"runId":"${run1}","text":"${token}"} apply ${digest.slice(0, 12)} after ${run2}` },
      ]);
    const a = side("20261113T010203Z-aaaaaaaa", "20261113T010204Z-bbbbbbbb", "[[CODARYN_SECRET:0123456789abcdef]]", HEX("a"));
    const b = side("20261114T050607Z-cccccccc", "20261114T050608Z-dddddddd", "[[CODARYN_SECRET:fedcba9876543210]]", HEX("b"));
    assert.deepEqual([...a], [...b]);
    assert.deepEqual([...a.keys()], ["step 1 | stdout", "file .codaryn/runs/<RUN-1>/journal.jsonl"]);
    assert.match([...a.values()][0] ?? "", /"digest":"<DIGEST-1>".*"sha256":"c{64}"/);
    assert.match([...a.values()][1] ?? "", /"text":"<TOKEN-1>"} apply <DIGEST-1:12> after <RUN-2>/);
  });

  test("a value in another place is a difference: labels follow appearance", () => {
    const a = normalizeSide([{ key: "k", text: "first 20261113T010203Z-aaaaaaaa then 20261113T010204Z-bbbbbbbb" }]);
    const b = normalizeSide([{ key: "k", text: "first 20261113T010204Z-bbbbbbbb then 20261113T010204Z-bbbbbbbb" }]);
    assert.notDeepEqual([...a], [...b]);
  });

  test("times, durations and a lock's pid are replaced; the case and build folders in every form", () => {
    const folder = ["C:", "Temp", "case"].join(BACKSLASH);
    const escaped = ["C:", "Temp", "case"].join(BACKSLASH + BACKSLASH);
    const text = [
      '{"at":"2026-11-13T01:02:03.456Z","durationMs":42,"pid":777}',
      "run: x (started 2026-11-13 12:18:22)",
      "- Duration: 45 ms of 60000 ms",
      "Usage: model turns 3 · tool calls 2 · 0.1 s",
      "사용: 모델 3턴 · 도구 호출 2회 · 0.3초",
      `${folder}${BACKSLASH}work and C:/Temp/case/work and "${escaped}${BACKSLASH}${BACKSLASH}work"`,
    ].join("\n");
    const [out] = normalizeSide([{ key: "k", text }], { paths: [{ forms: pathForms(folder), label: "<CASE>" }] }).values();
    assert.equal(
      out,
      [
        '{"at":"<TIME>","durationMs":<MS>,"pid":<PID>}',
        "run: x (started <TIME>)",
        "- Duration: <MS> ms of 60000 ms",
        "Usage: model turns 3 · tool calls 2 · <S> s",
        "사용: 모델 3턴 · 도구 호출 2회 · <S>초",
        `<CASE>${BACKSLASH}work and <CASE>/work and "<CASE>${BACKSLASH}${BACKSLASH}work"`,
      ].join("\n"),
    );
  });

  // U-167 (ne-verify's report-main-health): a run over 100 ms writes one more digit of "durationMs"
  // in journal.jsonl and result.json, so the records folder that cleanup measures is 2 bytes larger.
  // cleanup's output (text and JSON) gives that size: there it is <BYTES>. The record files are
  // compared as they are (their "durationMs" is <MS> already), and no other step's numbers change.
  test("U-167: cleanup steps' byte counts are <BYTES>; record files and other steps keep theirs", { todo: "U-167" }, () => {
    const side = (bytes) =>
      normalizeSide([
        { key: "step 2: codaryn cleanup --workspace work --run 20261113T010203Z-aaaaaaaa | stdout", text: `Run records: 1 (${bytes} bytes)\nRemoved only with --include-not-reverted besides: 1 (${bytes} bytes). These are runs\n1 file(s), ${bytes} bytes` },
        { key: "step 3: codaryn cleanup --workspace work --run 20261113T010203Z-aaaaaaaa | stdout", text: `실행 기록: 1개(${bytes}바이트)\n파일 1개, ${bytes}바이트` },
        { key: "step 4: codaryn cleanup --workspace work --run 20261113T010203Z-aaaaaaaa --json | stdout", text: `{"summary":{"runs":{"count":1,"bytes":${bytes},"oldest":null},"discarded":{"runs":0,"files":0,"bytes": ${bytes}}}}` },
        { key: "step 1: codaryn run --task task.json | stderr", text: `codaryn: wrote ${bytes} bytes` },
        { key: "file work/.codaryn/runs/20261113T010203Z-aaaaaaaa/result.json", text: `{"bytes":${bytes},"note":"${bytes} bytes"}` },
      ]);
    const a = [...side(7093).values()];
    const b = [...side(7095).values()];
    assert.deepEqual(a.slice(0, 3), b.slice(0, 3), "the cleanup steps are the same");
    assert.deepEqual(a.slice(0, 3), [
      "Run records: 1 (<BYTES> bytes)\nRemoved only with --include-not-reverted besides: 1 (<BYTES> bytes). These are runs\n1 file(s), <BYTES> bytes",
      "실행 기록: 1개(<BYTES>바이트)\n파일 1개, <BYTES>바이트",
      '{"summary":{"runs":{"count":1,"bytes":<BYTES>,"oldest":null},"discarded":{"runs":0,"files":0,"bytes": <BYTES>}}}',
    ]);
    assert.deepEqual([a[3], a[4]], ["codaryn: wrote 7093 bytes", '{"bytes":7093,"note":"7093 bytes"}'], "another step and a record file are kept");
    assert.notDeepEqual([b[3], b[4]], [a[3], a[4]]);
  });
});

describe("diffLines and compareSides", () => {
  test("a changed line is named with its line and first differing column; an added line too", () => {
    assert.deepEqual(diffLines("a\nturn 1\nc", "a\nround 1\nc\nd"), [
      { kind: "change", baseLine: 2, headLine: 2, column: 1, base: "turn 1", head: "round 1" },
      { kind: "added", headLine: 4, head: "d" },
    ]);
  });

  test("an artifact on one side only is named", () => {
    const found = compareSides(new Map([["x", "1"], ["y", "2"]]), new Map([["x", "1"], ["z", "3"]]));
    assert.deepEqual(found.map((item) => [item.key, item.kind]), [["y", "only-base"], ["z", "only-head"]]);
  });
});

describe("two real builds of HEAD", () => {
  const work = mkdtempSync(path.join(tmpdir(), "codaryn-compare-test-"));
  after(() => rmSync(work, { recursive: true, force: true }));
  let base;

  test("the same build compared with itself: no difference in any case", { timeout: 900_000 }, async () => {
    base = await prepareBoard({ commit: "HEAD", dir: path.join(work, "base") });
    const results = await compareBuilds({ base, head: base, caseDir: path.join(work, "case") });
    assert.deepEqual(results.map((result) => result.name), CASES.map((spec) => spec.name));
    const differing = results.filter((result) => result.differences.length > 0 || result.fence.length > 0);
    assert.deepEqual(differing.map((result) => result.name), [], reportOf({ base, head: base, results }));
    assert.ok(results.every((result) => result.artifacts > 0));
  });

  test("a build with catalog lines changed: each is found where it shows, a terminal question too", { timeout: 900_000 }, async () => {
    assert.ok(base !== undefined, "the first test made the base build");
    const head = await prepareBoard({
      commit: "HEAD",
      dir: path.join(work, "head"),
      alter: (dir) => {
        const file = path.join(dir, "src", "i18n", "en.ts");
        const before = readFileSync(file, "utf8");
        const turned = before.replace('"progress.turn": "turn {turn}"', '"progress.turn": "round {turn}"');
        assert.notEqual(turned, before, "the progress line to change is there");
        // U-135: the apply question, which only the terminal case shows.
        const changed = turned.replace('"apply.question": "Apply this plan?"', '"apply.question": "Apply the plan?"');
        assert.notEqual(changed, turned, "the question to change is there");
        writeFileSync(file, changed, "utf8");
      },
    });
    const names = ["document-run", "document-run-ko", "plan-apply", "terminal-apply-yes"];
    const cases = CASES.filter((spec) => names.includes(spec.name));
    const results = await compareBuilds({ base, head, cases, caseDir: path.join(work, "case") });
    const byName = new Map(results.map((result) => [result.name, result]));
    assert.deepEqual(byName.get("document-run-ko")?.differences, [], "the Korean case does not use the English line");
    // Both apply cases' plan runs show the turn line; only the terminal apply asks its question.
    const turnLinesOnly = (difference) => difference.lines.every((line) => /codaryn: turn \d+$/.test(line.base) && /codaryn: round \d+$/.test(line.head));
    const planRun = "step 1: codaryn run --task task.json | stderr";
    const digested = byName.get("plan-apply")?.differences ?? [];
    assert.deepEqual(digested.map((item) => item.key), [planRun], "an apply with --digest asks nothing");
    assert.ok(turnLinesOnly(digested[0]));
    const asked = byName.get("terminal-apply-yes")?.differences ?? [];
    assert.deepEqual(asked.map((item) => item.key), [planRun, 'step 2: codaryn apply --task task.json --run <RUN-1> [terminal: stdin,stdout,stderr answers ["y"]] | stderr']);
    assert.ok(turnLinesOnly(asked[0]));
    assert.ok((asked[1]?.lines ?? []).length > 0);
    for (const line of asked[1]?.lines ?? []) {
      assert.match(line.base, /Apply this plan\?/);
      assert.match(line.head, /Apply the plan\?/);
    }
    const differences = byName.get("document-run")?.differences ?? [];
    assert.deepEqual(differences.map((item) => item.key), ["step 1: codaryn run --task task.json | stderr"]);
    const lines = differences[0]?.lines ?? [];
    assert.ok(lines.length > 0);
    for (const line of lines) {
      assert.equal(line.kind, "change");
      assert.match(line.base, /codaryn: turn \d+$/);
      assert.match(line.head, /codaryn: round \d+$/);
    }
    assert.match(reportOf({ base, head, results }), /- base \d+:\d+: codaryn: turn 1\n\+ head \d+:\d+: codaryn: round 1/);
  });
});
