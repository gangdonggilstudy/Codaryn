/** One real CLI/host completed pair; controls mutate copies, never product files or stored logs. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertIPC, compareStored, evidence, object, runPair, sha, tokenAnchors, validateStored } from "./cli-host-parity-support.js";
import type { Stored } from "./cli-host-parity-support.js";

function toolResult(value: Stored, callId: string) {
  return object(value.records.find((r) => r.type === "tool_result" && object(r.result, "control tool result").callId === callId)?.result, "control target exists");
}
function renamed(value: Stored): Stored {
  const changed = structuredClone(value), id = "20991231T235959Z-0123abcd";
  changed.result.runId = id;
  changed.result.journalPath = `.codaryn/runs/${id}/journal.jsonl`;
  object(changed.result.usage, "control usage").durationMs = 37;
  for (const row of changed.records) { row.runId = id; row.at = "2099-12-31T23:59:59.000Z"; }
  object(changed.records.at(-1)!.usage, "control final usage").durationMs = 37;
  const anchors = tokenAnchors(changed), replacements = ["[[CODARYN_SECRET:0000000000000001]]", "[[CODARYN_SECRET:0000000000000002]]"];
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return node.replace(/\[\[CODARYN_SECRET:[0-9a-f]{16}\]\]/g, (token) => replacements[anchors.indexOf(token)]!);
    if (Array.isArray(node)) return node.map(walk);
    if (typeof node === "object" && node !== null) return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, walk(item)]));
    return node;
  };
  const result = object(walk(changed), "renamed bundle");
  return { result: object(result.result, "renamed result"), records: result.records as Stored["records"] };
}

test("one scripted CLI and separate real host retain complete stored parity and minimized IPC", { timeout: 120_000 }, async (t) => {
  const pair = await runPair(t);
  validateStored(pair.cli); validateStored(pair.host);
  assertIPC(pair.ipcDone, pair.host);
  const original: Stored = structuredClone({ result: pair.cli.result, records: pair.cli.records });
  const rawHashes = () => [pair.cli.resultText, pair.cli.journalText, pair.host.resultText, pair.host.journalText].map(sha);
  const rawBefore = rawHashes();
  const sibling = structuredClone(original), before = JSON.stringify(original), siblingBefore = JSON.stringify(sibling);
  const controls: { name: string; rejected?: boolean; diagnostic?: string; accepted?: boolean }[] = [];
  const cases: { name: string; expected: RegExp; mutate(value: Stored): void }[] = [
    { name: "status", expected: /status/, mutate: (v) => { v.result.status = "failed"; } },
    { name: "errorCode", expected: /errorCode/, mutate: (v) => { toolResult(v, "wdeny").errorCode = "io_error"; } },
    { name: "policy allowed", expected: /policy/, mutate: (v) => {
      const row = v.records.find((r) => r.type === "tool_decision" && r.callId === "wdeny");
      assert.ok(row, "policy control target exists"); row.allowed = true;
    } },
    { name: "record order", expected: /kinds\/order/, mutate: (v) => {
      const i = v.records.findIndex((row, index) => index + 1 < v.records.length && row.type !== v.records[index + 1]!.type);
      assert.ok(i >= 0, "adjacent distinct-kind control target exists");
      [v.records[i], v.records[i + 1]] = [v.records[i + 1]!, v.records[i]!];
    } },
    { name: "token merge", expected: /privacy/, mutate: (v) => {
      const [a, b] = tokenAnchors(v), row = toolResult(v, "r1");
      assert.equal(typeof row.content, "string"); row.content = (row.content as string).replace(b, a);
    } },
    { name: "ISO-looking ordinary content", expected: /finalMessage/, mutate: (v) => {
      object(v.result.finalMessage, "final message control target").text = "2099-12-31T23:59:59.000Z";
    } },
    { name: "foreign valid record runId", expected: /runId/, mutate: (v) => { v.records[1]!.runId = "20991231T235959Z-89abcdef"; } },
    { name: "unknown property survives", expected: /complete stored/, mutate: (v) => { v.result.extraObservation = { retained: true }; } },
  ];
  for (const control of cases) await t.test(`copied observation rejects ${control.name}`, () => {
    const copy = structuredClone(original); control.mutate(copy);
    let rejected: unknown;
    try { compareStored(original, copy); } catch (error) { rejected = error; }
    assert.ok(rejected instanceof assert.AssertionError, "same comparator must reject the copied mutation");
    assert.match(rejected.message, control.expected, "relevant failing invariant/path");
    assert.equal(JSON.stringify(original), before, "original complete JSON unchanged");
    assert.equal(JSON.stringify(sibling), siblingBefore, "sibling clone unchanged");
    controls.push({ name: control.name, rejected: true, diagnostic: rejected.message });
  });
  await t.test("copied approved nondeterminism is accepted", () => {
    compareStored(original, renamed(original));
    assert.equal(JSON.stringify(original), before); assert.equal(JSON.stringify(sibling), siblingBefore);
    controls.push({ name: "consistent approved nondeterminism", accepted: true });
  });
  assert.deepEqual(rawHashes(), rawBefore, "all original raw result/journal observations unchanged by controls");
  evidence("controls", { productPairs: 1, negativeControls: cases.length, positiveControls: 1, controls, originalJSON_SHA256: sha(before), siblingJSON_SHA256: sha(siblingBefore), originalUnchanged: JSON.stringify(original) === before, rawObservationHashes: rawBefore });
  // Sensitivity controls above run before trusting the actual cross-process comparison.
  const normalization = compareStored(pair.cli, pair.host);
  evidence("normalization", normalization);
});
