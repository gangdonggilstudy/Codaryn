/**
 * U-232 (bundle A; A-8 to come, proposal docs/reviews/2026-11-13-p1-bundle-proposal.md 3.1): the
 * harness's own test. The private data tables (tests/fixtures/private-tables.ts) and the finder
 * (tests/support/private-canary.ts) are for the canary test bundle A brings with its unreadable
 * paths and query_table. Main has neither yet, so here every run reads the private folder openly,
 * and the harness must find what that let out:
 * - the tables: the product's own table reader (src/tabular) reads each format to the fixture's
 *   oracle, and k = 5 (the contract's shownGroups) shows and hides exactly the keys the fixture says;
 * - the finder: a marker as written, with Hangul escaped as \uXXXX, inside JSON in JSON, cut short
 *   (with fragments), and nothing in clean text;
 * - fake Anthropic and fake OpenAI runs (no key, 127.0.0.1): every marker the model was sent is found
 *   in what Codaryn sent (the model's own earlier turns left out), in the records and in the
 *   outputs, and markers that were never read are found nowhere;
 * - a scripted run: the journals' model_request records are the model channel;
 * - a run that never touches the private folder: nothing is found anywhere.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { CODARYN_API_BASE_URL_ENV, CODARYN_OPENAI_API_BASE_URL_ENV, DEFAULT_MIN_GROUP_SIZE, shownGroups } from "../../src/contracts/index.js";
import type { QueryOperation, VerifierConfig } from "../../src/contracts/index.js";
import { queryTable } from "../../src/tabular/index.js";
import { FAKE_MODEL_TASK, writeAnthropicTask } from "../fixtures/anthropic.js";
import { createSandbox } from "../fixtures/builders.js";
import { textStep, toolStep, writeGeneralTask } from "../fixtures/general-tasks.js";
import { writeOpenAITask } from "../fixtures/openai.js";
import {
  GROUP_COLUMNS,
  PRIVATE_COLUMNS,
  PRIVATE_ROWS,
  groupsOf,
  neverShownKeysOf,
  renderTable,
  rowMarkersOf,
  shownKeysOf,
  writePrivateWorkspace,
} from "../fixtures/private-tables.js";
import type { GroupColumn, PrivateCanary, PrivateTableFile } from "../fixtures/private-tables.js";
import { FAKE_API_KEY, FAKE_OPENAI_KEY } from "../fixtures/secrets.js";
import { cliEnv, expectRunResult } from "../support/cli.js";
import { MOCK_LABEL, replyText, replyTools, runGuarded, startFakeAnthropic, text, toolUse } from "../support/fake-anthropic.js";
import { fnCall, outputMessage, replyCalls, replyFinal, startFakeOpenAI } from "../support/fake-openai.js";
import { canarySources, describeFindings, findCanary, foundIn, leaksOf, markerForms, modelEchoSources } from "../support/private-canary.js";
import type { ChannelSource } from "../support/private-canary.js";

const GUIDE_EXISTS: VerifierConfig[] = [{ id: "guide", kind: "file_rules", rules: [{ type: "exists", path: "public/guide.md" }] }];
const OPERATIONS: QueryOperation[] = [
  { op: "count", column: "amount" },
  { op: "sum", column: "amount" },
  { op: "sum", column: "age" },
  { op: "mean", column: "amount" },
];
const QUERIES: readonly (readonly GroupColumn[])[] = [[], ["region"], ["team"], ["region", "team"]];

const tableOf = (canary: PrivateCanary, format: PrivateTableFile["format"]): PrivateTableFile => {
  const file = canary.tables.find((table) => table.format === format);
  assert.ok(file !== undefined, format);
  return file;
};

/** Every marker of the canary, all kinds. */
const allMarkers = (canary: PrivateCanary): string[] => [...canary.rowMarkers, ...canary.nameMarkers, ...canary.tables.flatMap((file) => GROUP_COLUMNS.flatMap((column) => file.table.keys[column]))];

test("U-232: the tables - unique markers, three formats the product's table reader reads to the fixture's oracle, and k = 5 hides exactly the small groups' keys", async (t) => {
  const canary = writePrivateWorkspace(createSandbox(t));
  const markers = allMarkers(canary);
  assert.equal(new Set(markers).size, markers.length, "every marker once");
  for (const marker of markers) {
    assert.match(marker, /^[A-Za-z][A-Za-z0-9가-힣]{11}$/u, marker);
    assert.equal([...marker].filter((char) => char >= "가").length, 3, `three Hangul syllables in ${marker}`);
    assert.equal(JSON.stringify(marker), `"${marker}"`, "nothing JSON escapes");
    assert.ok(!markers.some((other) => other !== marker && other.includes(marker)), `${marker} is no part of another`);
  }
  assert.equal(canary.k, DEFAULT_MIN_GROUP_SIZE);
  assert.equal(canary.rowMarkers.length, 3 * PRIVATE_ROWS * 3 + 7);

  for (const file of canary.tables) {
    const bytes = Buffer.from(renderTable(file.table, file.format), "utf8");
    for (const groupBy of QUERIES) {
      const label = `${file.format} by [${groupBy.join(", ")}]`;
      const read = await queryTable([bytes], file.format, { groupBy, operations: OPERATIONS });
      assert.ok(read.ok, `${label}: ${JSON.stringify(read)}`);
      assert.deepEqual([read.rows, read.withoutKey], [PRIVATE_ROWS, 0], label);
      const oracle = groupsOf(file.table, groupBy);
      assert.deepEqual(
        read.groups.map((group) => ({ keys: group.keys, rows: group.rows, values: group.values })),
        oracle.map((group) => ({ keys: group.keys, rows: group.rows, values: [group.rows, group.sum.amount, group.sum.age, group.sum.amount / group.rows] })),
        label,
      );
      // The contract's one rule for k: shown keys are the fixture's, and no small key is among them.
      const shown = shownGroups(read.groups, canary.k);
      assert.deepEqual([...new Set(shown.groups.flatMap((group) => group.keys))], shownKeysOf(file.table, groupBy, canary.k), label);
      assert.equal(shown.suppressedGroups, oracle.filter((group) => group.rows < canary.k).length, label);
      for (const key of neverShownKeysOf(file.table, canary.k)) assert.ok(!shown.groups.some((group) => group.keys.includes(key)), `${label}: ${key}`);
    }
    // Sizes as documented: region 6, 5, 4, 1; team 7, 5, 3, 1; both: one group of 5.
    assert.deepEqual(groupsOf(file.table, ["region"]).map((group) => group.rows).sort((a, b) => b - a), [6, 5, 4, 1]);
    assert.deepEqual(groupsOf(file.table, ["team"]).map((group) => group.rows).sort((a, b) => b - a), [7, 5, 3, 1]);
    assert.deepEqual(groupsOf(file.table, ["region", "team"]).filter((group) => group.rows >= canary.k).map((group) => [group.keys, group.rows]), [[[file.table.keys.region[0], file.table.keys.team[0]], 5]]);
  }
  assert.equal(canary.smallKeys.length, 3 * 4, "two keys per group column under k, in three tables");
  assert.equal(canary.largeKeys.length, 3 * 4, "two keys per group column at least k, in three tables");
  assert.deepEqual(tableOf(canary, "csv").table.rows.length, PRIVATE_ROWS);
  assert.deepEqual(Object.keys(tableOf(canary, "jsonl").table.rows[0] ?? {}), [...PRIVATE_COLUMNS]);
});

test("U-232: the finder - as written, Hangul as \\uXXXX, JSON in JSON, cut short with fragments, nothing in clean text", (t) => {
  const canary = writePrivateWorkspace(createSandbox(t));
  const [raw, escaped, nested, cut, absent] = canary.rowMarkers as [string, string, string, string, string];
  const asciiEscaped = escaped.replace(/[^\u0000-\u007f]/gu, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
  const sources: ChannelSource[] = [
    { channel: "output", label: "plain", text: `before ${raw} after` },
    { channel: "output", label: "ascii json", text: `{"text":"${asciiEscaped}"}` },
    { channel: "records", label: "json in json", text: JSON.stringify({ outer: JSON.stringify({ inner: JSON.stringify({ value: nested }) }) }) },
    { channel: "model", label: "cut", text: `… ${cut.slice(0, 9)}` },
    { channel: "model", label: "clean", text: "no marker here, only words and 12345 and 가나다" },
  ];
  const list = { row: [raw, escaped, nested, cut, absent] };
  const plain = findCanary(sources, list);
  assert.deepEqual(plain.map((finding) => [finding.marker, finding.source]).sort(), [[escaped, "ascii json"], [nested, "json in json"], [raw, "plain"]].sort(), describeFindings(plain));
  assert.ok(plain.some((finding) => finding.marker === escaped && finding.form.startsWith("ascii-json")), "found as \\uXXXX");
  const withPieces = findCanary(sources, list, { fragments: 8 });
  assert.deepEqual(withPieces.filter((finding) => finding.marker === cut).map((finding) => finding.source), ["cut"]);
  assert.equal(withPieces.filter((finding) => finding.marker === absent).length, 0);
  assert.ok(markerForms(raw).length >= 8);
});

test(`${MOCK_LABEL} U-232: an Anthropic run that reads the private folder openly - what was sent is found in what Codaryn sent, the records and the outputs; what was never read is found nowhere`, { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  const canary = writePrivateWorkspace(sb);
  const csv = tableOf(canary, "csv");
  const tsv = tableOf(canary, "tsv");
  const jsonl = tableOf(canary, "jsonl");
  const searchedRow = tsv.table.rows[3];
  assert.ok(searchedRow !== undefined);
  // The model's own words carry a marker that is in no file it reads: it comes back as conversation only.
  const echoed = jsonl.table.rows[0]?.person ?? "";
  const smallKey = csv.table.keys.region[2] ?? "";
  const quoted = csv.table.rows[0]?.person ?? "";
  const [fileName] = canary.nameMarkers as [string];
  const api = await startFakeAnthropic(t, [
    replyTools([text(`I will look at the table first (${echoed}).`), toolUse("toolu_c1", "read_file", { path: csv.path })]),
    replyTools([toolUse("toolu_s1", "search_files", { path: ".", text: searchedRow.person })]),
    replyTools([toolUse("toolu_s2", "search_files", { path: ".", nameContains: fileName })]),
    replyTools([toolUse("toolu_n1", "read_file", { path: `${canary.dir}/notes.txt` })]),
    replyText(`The small group ${smallKey} holds ${quoted}.`),
  ]);
  const task = writeAnthropicTask(sb, { id: "u232-anthropic", goal: "Summarise the people tables by region.", workflow: "document", model: FAKE_MODEL_TASK, maxOutputTokens: 800, verifiers: GUIDE_EXISTS });
  const run = await runGuarded(sb, ["run", "--task", task], cliEnv({ fakeApiKey: FAKE_API_KEY, extra: { [CODARYN_API_BASE_URL_ENV]: api.url } }));
  const result = expectRunResult(run, "anthropic");
  assert.deepEqual([result.status, result.reason], ["done", "verified"], run.stderr);
  const sources = canarySources({ workspace: sb.workspace, runs: { run }, anthropic: api });
  const findings = findCanary(sources, canary);

  const sent = [...rowMarkersOf(csv.table), searchedRow.person, searchedRow.contact, searchedRow.memo, fileName, ...canary.fileMarkers.slice(0, 5)];
  const csvKeys = GROUP_COLUMNS.flatMap((column) => csv.table.keys[column]);
  assert.deepEqual(foundIn(findings, "model", sent), sent, "every marker the tools returned is found in what Codaryn sent");
  assert.deepEqual(foundIn(findings, "model", csvKeys), csvKeys, "the read table's keys, small and large");
  assert.deepEqual(foundIn(findings, "records", sent), sent, "and in the records");
  // The model's own earlier words are left out of the model channel, but are in the whole bodies.
  assert.deepEqual(foundIn(findings, "model", [echoed]), []);
  assert.deepEqual(foundIn(findCanary(modelEchoSources(api, "anthropic"), { row: [echoed] }), "model", [echoed]), [echoed]);
  // The last answer reaches the person: stdout (JSON), stderr (the end summary), result.json.
  for (const label of ["run stdout", "run stderr"]) {
    assert.ok(findings.some((finding) => finding.marker === quoted && finding.source === label), `${quoted} in ${label}`);
    assert.ok(findings.some((finding) => finding.marker === smallKey && finding.kind === "small_key" && finding.source === label), `${smallKey} in ${label}`);
  }
  assert.ok(findings.some((finding) => finding.marker === quoted && finding.source.endsWith("result.json")), "in result.json");
  // Never read: the other rows and the keys of the JSON Lines table, the folder name, the two files
  // whose names only were listed or never seen.
  const unread = [...rowMarkersOf(jsonl.table).filter((marker) => marker !== echoed), ...GROUP_COLUMNS.flatMap((column) => jsonl.table.keys[column]), canary.nameMarkers[1] ?? "", ...canary.fileMarkers.slice(5)];
  const strays = findings.filter((finding) => unread.includes(finding.marker));
  assert.deepEqual(strays, [], describeFindings(strays));
  t.diagnostic(`findings: ${findings.length}; leaks by kind: ${JSON.stringify(Object.fromEntries(["row", "name", "small_key"].map((kind) => [kind, new Set(leaksOf(findings).filter((f) => f.kind === kind).map((f) => f.marker)).size])))}`);
  t.diagnostic(`stdout forms: ${[...new Set(findings.filter((finding) => finding.source === "run stdout").map((finding) => finding.form))].join(", ")}`);
});

test(`${MOCK_LABEL} U-232: an OpenAI run that reads a private table openly - found in what Codaryn sent, not the model's own turns`, { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  const canary = writePrivateWorkspace(sb);
  const jsonl = tableOf(canary, "jsonl");
  const echoed = tableOf(canary, "csv").table.rows[1]?.memo ?? "";
  const smallKey = jsonl.table.keys.team[3] ?? "";
  const api = await startFakeOpenAI(t, [
    replyCalls([outputMessage(`Reading the lines (${echoed}).`), fnCall("call_j1", "read_file", { path: jsonl.path })]),
    replyFinal(`Team ${smallKey} has one person.`),
  ]);
  const task = writeOpenAITask(sb, { id: "u232-openai", goal: "Summarise the people table by team.", verifiers: GUIDE_EXISTS });
  const run = await runGuarded(sb, ["run", "--task", task], cliEnv({ fakeOpenAiKey: FAKE_OPENAI_KEY, extra: { [CODARYN_OPENAI_API_BASE_URL_ENV]: api.baseUrl } }));
  const result = expectRunResult(run, "openai");
  assert.deepEqual([result.status, result.reason], ["done", "verified"], run.stderr);
  const findings = findCanary(canarySources({ workspace: sb.workspace, runs: { run }, openai: api }), canary);
  const sent = rowMarkersOf(jsonl.table);
  assert.deepEqual(foundIn(findings, "model", sent), sent);
  assert.deepEqual(foundIn(findings, "records", sent), sent);
  assert.deepEqual(foundIn(findings, "model", [echoed]), []);
  assert.deepEqual(foundIn(findCanary(modelEchoSources(api, "openai"), { row: [echoed] }), "model", [echoed]), [echoed]);
  assert.deepEqual(foundIn(findings, "output", [smallKey]), [smallKey]);
  const csvStrays = findings.filter((finding) => rowMarkersOf(tableOf(canary, "csv").table).includes(finding.marker) && finding.marker !== echoed);
  assert.deepEqual(csvStrays, [], describeFindings(csvStrays));
});

test("U-232: a scripted run - the journals' model_request records are the model channel, the model's own turns left out (U-236)", { timeout: 60_000 }, async (t) => {
  const sb = createSandbox(t);
  const canary = writePrivateWorkspace(sb);
  const tsv = tableOf(canary, "tsv");
  // U-236: the model's own text and calls come back in the next model_request's newMessages (role
  // assistant); a marker there is the model's, not one Codaryn sent.
  const echoed = tableOf(canary, "jsonl").table.rows[2]?.contact ?? "";
  const reading = { ...toolStep("read_file", { path: tsv.path }), text: `Reading the table (${echoed}).` };
  const task = writeGeneralTask(sb, { id: "u232-scripted", verifiers: [{ id: "guide", kind: "file_rules", rules: [{ type: "exists", path: "public/guide.md" }] }] }, [reading, textStep("read")]);
  const run = await runGuarded(sb, ["run", "--task", task], cliEnv());
  assert.deepEqual([expectRunResult(run).status, expectRunResult(run).reason], ["done", "verified"], run.stderr);
  const findings = findCanary(canarySources({ workspace: sb.workspace, runs: { run }, scripted: true }), canary);
  const sent = rowMarkersOf(tsv.table);
  assert.deepEqual(foundIn(findings, "model", sent), sent);
  assert.ok(findings.filter((finding) => finding.channel === "model").every((finding) => finding.source.includes("model_request")));
  assert.deepEqual(foundIn(findings, "output", sent), [], "a tool result is not printed");
  assert.deepEqual(foundIn(findings, "model", [echoed]), [], "the model's own words are not what Codaryn sent");
  assert.deepEqual(foundIn(findings, "records", [echoed]), [echoed], "they are recorded");
});

test(`${MOCK_LABEL} U-232: a run that never touches the private folder - nothing is found in any channel`, { timeout: 90_000 }, async (t) => {
  const sb = createSandbox(t);
  const canary = writePrivateWorkspace(sb);
  const api = await startFakeAnthropic(t, [
    replyTools([toolUse("toolu_g1", "read_file", { path: "public/guide.md" })]),
    replyTools([toolUse("toolu_g2", "search_files", { path: "public", nameContains: "guide" })]),
    replyText("Only the guide was read."),
  ]);
  const task = writeAnthropicTask(sb, { id: "u232-clean", goal: "Read the guide.", workflow: "document", model: FAKE_MODEL_TASK, maxOutputTokens: 800, verifiers: GUIDE_EXISTS });
  const run = await runGuarded(sb, ["run", "--task", task], cliEnv({ fakeApiKey: FAKE_API_KEY, extra: { [CODARYN_API_BASE_URL_ENV]: api.url } }));
  assert.equal(expectRunResult(run, "anthropic").status, "done", run.stderr);
  const report = await runGuarded(sb, ["report", "--workspace", sb.workspace, "--run", "latest"], cliEnv());
  const sources = [...canarySources({ workspace: sb.workspace, runs: { run, report }, anthropic: api, scripted: true }), ...modelEchoSources(api, "anthropic")];
  assert.ok(sources.length > 10, `sources: ${sources.length}`);
  const findings = findCanary(sources, canary, { fragments: 8 });
  assert.deepEqual(findings, [], describeFindings(findings));
});
