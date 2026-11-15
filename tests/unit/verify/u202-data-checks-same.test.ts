/**
 * U-202 (bundle A, A-2, Q-7): data_checks reads its tables in chunks now. Its result must be the one
 * the whole-table reading gave, letter for letter: outcome, evidence, checked and limits. The frozen
 * copy of the verifier before the change (./reference/data-checks-v1.ts, with the frozen parser and
 * aggregate) and the verifier now run on the same files and rules, with chunks from 1 byte to the
 * default, over fixed cases (every verdict path) and seeded random tables, targets and rules.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import type { AggregateOp, DataChecksVerifierConfig, DataRule, TableFormat, TableRef, Workspace } from "../../../src/contracts/index.js";
import { runDataChecksVerifier } from "../../../src/verify/data-checks.js";
import { createWorkspace } from "../../../src/workspace/index.js";
import { aggregate as aggregateV1 } from "../tabular/reference/aggregate-v1.js";
import { findColumn as findColumnV1, parseTable as parseTableV1 } from "../tabular/reference/table-v1.js";
import { runDataChecksVerifier as runDataChecksVerifierV1 } from "./reference/data-checks-v1.js";

let root = "";
let workspace: Workspace;

/** Chunk sizes: one byte splits every UTF-8 sequence and CRLF; the default reads small files whole. */
const CHUNKS = [1, 2, 5, 13, undefined] as const;
/** The random rounds use fewer sizes (one-byte reads of every random file would take long). */
const RANDOM_CHUNKS = [3, 7, undefined] as const;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "codaryn-u202-"));
  for (const dir of ["f", "r", ".codaryn", "f/dir.csv"]) await mkdir(join(root, dir), { recursive: true });
  workspace = await createWorkspace({ root });
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(name: string, content: string | Uint8Array): Promise<void> {
  await writeFile(join(root, name), content);
}

const ref = (path: string, format: TableFormat = "csv"): TableRef => ({ path, format });

async function same(rules: readonly unknown[], label: string, maxTableBytes?: number, chunks: readonly (number | undefined)[] = CHUNKS): Promise<void> {
  const config = { id: "data", kind: "data_checks", rules } as unknown as DataChecksVerifierConfig;
  const signal = new AbortController().signal;
  const options = maxTableBytes === undefined ? {} : { maxTableBytes };
  const want = await runDataChecksVerifierV1(config, workspace, signal, options);
  for (const chunkBytes of chunks) {
    const got = await runDataChecksVerifier(config, workspace, signal, { ...options, ...(chunkBytes === undefined ? {} : { chunkBytes }) });
    assert.deepEqual(got, want, `${label} (chunks of ${chunkBytes ?? "default"}):\nwant ${want.evidence}\ngot  ${got.evidence}`);
  }
}

const sum = (source: TableRef, target: TableRef, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: "aggregate_match",
  source,
  column: "v",
  op: "sum",
  target,
  targetColumn: "total",
  ...extra,
});
const grouped = (source: TableRef, target: TableRef, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  sum(source, target, { groupBy: "k", targetKeyColumn: "k", ...extra });
const shape = (table: TableRef, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ type: "table_shape", table, ...extra });

test("U-202: fixed cases through every verdict path give the same result, letter for letter, for every chunk size", async () => {
  const files: Record<string, string | Uint8Array> = {
    "f/s.csv": "k,v,w\na,1.5,x\nb,2,y\na,3,z\n,100,q\nc,,r\nc,1,s\n",
    "f/s-crlf.csv": "\uFEFFk,v,w\r\na,1.5,x\r\nb,2,y\r\na,3,z\r\n,100,q\r\nc,,r\r\nc,1,s\r\n\r\n",
    "f/s.tsv": "k\tv\tw\na\t1.5\tx\nb\t2\ty\na\t3\tz\n\t100\tq\nc\t\tr\nc\t1\ts\n",
    "f/s.jsonl": ['{"v":1.5,"k":"a"}', '{"k":"b","v":2}', '{"k":"a","v":"3"}', '{"v":100}', '{"k":"c","v":null}', '{"k":"c","v":1,"w":"s"}'].join("\n") + "\n",
    "f/late.jsonl": ['{"v":1}', '{"v":2}', '{"k":"a","v":3}'].join("\n"),
    "f/dup.csv": "k,v,v\na,1,2\n",
    "f/text.csv": "k,v\na,1\nb,seven\n",
    "f/huge.csv": "k,v\na,1e308\na,1e308\n",
    "f/empty-group.csv": "k,v\na,1\nb,\n",
    "f/broken.csv": 'k,v\na,"1\n',
    "f/fields.csv": "k,v\na,1,2\nb,\"x\n",
    "f/fields-then-ok.csv": "k,v\na\nb,2\n",
    "f/bare-cr.tsv": "k\tv\na\t1\t9\nb\r2\t3\n",
    "f/blank.jsonl": '{"k":"a"}\n\n{"k":"b"}',
    "f/empty.csv": "",
    "f/breaks.csv": "\n\r\n",
    "f/bom-only.csv": "\uFEFF",
    "r/total.csv": "total\n109.5\n",
    "r/total-wrong.csv": "total\n109\n",
    "r/total-two.csv": "total\n109.5\n1\n",
    "r/total-text.csv": "total\nlots\n",
    "r/total-empty.csv": "total\n\n",
    "r/total.jsonl": '{"total":109.5}',
    "r/total-late.jsonl": '{"x":1}',
    "r/g.csv": "k,total,note\na,4.5,n\nb,2,n\nc,1,n\n",
    "r/g-crlf.csv": "k,total\r\na,4.5\r\nb,2\r\nc,1\r\n",
    "r/g.tsv": "k\ttotal\na\t4.5\nb\t2\nc\t1\n",
    "r/g-wrong.csv": "k,total\na,4.5\nb,3\nc,1\n",
    "r/g-missing.csv": "k,total\na,4.5\nc,1\n",
    "r/g-dup.csv": "k,total\na,4.5\nb,2\nb,2\nc,1\n",
    "r/g-extra.csv": "k,total\na,4.5\nb,2\nc,1\nz,9\n,0\n",
    "r/g-text.csv": "k,total\na,x\nb,\nc,1\n",
    "r/g-dupcol.csv": "k,k,total\na,a,4.5\n",
    "r/g.jsonl": ['{"k":"a","total":4.5}', '{"total":2,"k":"b"}', '{"k":"c","total":1}'].join("\n"),
    "r/g-late.jsonl": ['{"total":2}', '{"k":"a","total":4.5}'].join("\n"),
    "r/many.csv": "k,total\n" + Array.from({ length: 30 }, (_, index) => `z${index},1`).join("\n") + "\n",
    "f/dir.csv/x": "",
  };
  for (const [name, content] of Object.entries(files)) await put(name, content);
  await put("r/latin1.csv", Uint8Array.from([0x74, 0x0a, 0xe9, 0x0a]));
  // Not UTF-8 after a parse problem: the whole-table reading said "not UTF-8" first.
  await put("r/broken-latin1.csv", Uint8Array.from([...new TextEncoder().encode('total\n"1\n'), 0xff]));
  await put(".codaryn/hidden.csv", "total\n1\n");

  const s = ref("f/s.csv");
  const rules: [string, readonly unknown[], number?][] = [
    ["sum agrees", [sum(s, ref("r/total.csv"))]],
    ["sum from crlf and bom, tsv, jsonl", [sum(ref("f/s-crlf.csv"), ref("r/total.csv")), sum(ref("f/s.tsv", "tsv"), ref("r/total.csv")), sum(ref("f/s.jsonl", "jsonl"), ref("r/total.jsonl", "jsonl"))]],
    ["sum disagrees, two rows, text, empty", [sum(s, ref("r/total-wrong.csv")), sum(s, ref("r/total-two.csv")), sum(s, ref("r/total-text.csv")), sum(s, ref("r/total-empty.csv"))]],
    ["tolerance", [sum(s, ref("r/total-wrong.csv"), { tolerance: { absolute: 1 } }), sum(s, ref("r/total-wrong.csv"), { tolerance: { relative: 0.001 } })]],
    ["every op", (["sum", "count", "min", "max", "mean"] as AggregateOp[]).flatMap((op) => [sum(s, ref("r/total.csv"), { op }), grouped(s, ref("r/g.csv"), { op })])],
    ["grouped agrees, crlf, tsv, jsonl", [grouped(s, ref("r/g.csv")), grouped(ref("f/s-crlf.csv"), ref("r/g-crlf.csv")), grouped(ref("f/s.tsv", "tsv"), ref("r/g.tsv", "tsv")), grouped(ref("f/s.jsonl", "jsonl"), ref("r/g.jsonl", "jsonl"))]],
    ["grouped problems", [grouped(s, ref("r/g-wrong.csv")), grouped(s, ref("r/g-missing.csv")), grouped(s, ref("r/g-dup.csv")), grouped(s, ref("r/g-extra.csv")), grouped(s, ref("r/g-text.csv"))]],
    ["more than twenty problems", [grouped(s, ref("r/many.csv"))]],
    ["jsonl keys first seen late", [sum(ref("f/late.jsonl", "jsonl"), ref("r/total.csv")), grouped(ref("f/late.jsonl", "jsonl"), ref("r/g-late.jsonl", "jsonl")), sum(s, ref("r/total-late.jsonl", "jsonl"))]],
    ["columns missing and doubled", [sum(ref("f/dup.csv"), ref("r/total.csv")), grouped(s, ref("r/g-dupcol.csv")), sum(s, ref("r/total.csv"), { column: "nope" }), sum(s, ref("r/total.csv"), { targetColumn: "nope" }), grouped(s, ref("r/g.csv"), { groupBy: "nope" }), grouped(s, ref("r/g.csv"), { targetKeyColumn: "nope" })]],
    ["source problems", [sum(ref("f/text.csv"), ref("r/total.csv")), grouped(ref("f/text.csv"), ref("r/g.csv")), sum(ref("f/huge.csv"), ref("r/total.csv")), grouped(ref("f/empty-group.csv"), ref("r/g.csv"))]],
    ["tables that do not parse, as source and as target", [sum(ref("f/broken.csv"), ref("r/total.csv")), sum(s, ref("f/broken.csv")), sum(ref("f/fields.csv"), ref("r/total.csv")), sum(ref("f/fields-then-ok.csv"), ref("r/total.csv")), sum(ref("f/bare-cr.tsv", "tsv"), ref("r/total.csv")), sum(ref("f/blank.jsonl", "jsonl"), ref("r/total.csv"))]],
    ["empty tables", [shape(ref("f/empty.csv")), shape(ref("f/breaks.csv")), shape(ref("f/bom-only.csv")), shape(ref("f/empty.csv", "jsonl")), shape(ref("f/empty.csv", "tsv"))]],
    ["not UTF-8, also after a parse problem", [sum(s, ref("r/latin1.csv")), sum(ref("r/latin1.csv"), ref("r/total.csv")), shape(ref("r/broken-latin1.csv"))]],
    ["missing, a folder, refused paths", [sum(ref("f/none.csv"), ref("r/total.csv")), sum(s, ref("r/none.csv")), shape(ref("f/dir.csv")), sum(ref(".codaryn/hidden.csv"), ref("r/total.csv")), shape(ref("../outside.csv")), shape(ref("f/none/x.csv"))]],
    ["shapes", [
      shape(ref("r/g.csv"), { columns: ["k", "total", "note"] }),
      shape(ref("r/g.csv"), { columns: ["k", "total"] }),
      shape(ref("r/g.csv"), { columns: ["total", "k"], columnsMatch: "includes" }),
      shape(ref("r/g.csv"), { columns: ["total", "nope", "zz"], columnsMatch: "includes" }),
      shape(ref("r/g.csv"), { rows: { equals: 3 } }),
      shape(ref("r/g.csv"), { rows: { equals: 2 } }),
      shape(ref("r/g.csv"), { rows: { min: 1, max: 2 } }),
      shape(ref("r/g.csv"), { rows: { sameAs: ref("r/g.tsv", "tsv") } }),
      shape(ref("r/g.csv"), { rows: { sameAs: s } }),
      shape(ref("r/g.csv"), { columns: ["x"], rows: { sameAs: ref("f/none.csv") } }),
      shape(ref("f/s.jsonl", "jsonl"), { columns: ["v", "k", "w"] }),
      shape(ref("r/many.csv"), { columns: Array.from({ length: 25 }, (_, index) => `c${index}`) }),
    ]],
    ["invalid rules", [
      { type: "nope" },
      null,
      shape({ path: "", format: "csv" } as TableRef),
      shape(ref("r/g.csv"), { columns: "k" }),
      shape(ref("r/g.csv"), { columnsMatch: "some" }),
      shape(ref("r/g.csv"), { rows: { equals: 1, min: 1 } }),
      shape(ref("r/g.csv"), { rows: { equals: -1 } }),
      shape(ref("r/g.csv"), { rows: { sameAs: { path: "x" } } }),
      shape(ref("r/g.csv"), { rows: { min: 1.5 } }),
      sum(s, ref("r/total.csv"), { op: "median" }),
      sum(s, ref("r/total.csv"), { groupBy: "k" }),
      sum(s, ref("r/total.csv"), { tolerance: { absolute: -1 } }),
      sum(s, ref("r/total.csv"), { column: 5 }),
      grouped(s, ref("r/g.csv"), { groupBy: 3 }),
    ]],
  ];
  for (const [label, list] of rules) await same(list, label);
  // The size limit: the source and the target, exactly at the limit and one byte over.
  const size = new TextEncoder().encode(files["r/total.csv"] as string).length;
  await same([sum(s, ref("r/total.csv")), sum(ref("r/total.csv"), ref("r/total.csv"))], "limit at the size", Math.max(size, new TextEncoder().encode(files["f/s.csv"] as string).length));
  await same([sum(s, ref("r/total.csv")), sum(ref("r/total.csv"), ref("r/total.csv"))], "limit one under", size - 1);
});

/** mulberry32. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;

function numberCell(rng: Rng): string {
  const roll = rng();
  if (roll < 0.15) return "";
  if (roll < 0.18) return pick(rng, ["x", "1,5", "+2", " 3"]);
  if (roll < 0.2) return pick(rng, ["1e308", "-1e308"]);
  return String(Math.round((rng() * 200 - 100) * 100) / 100);
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** A table text in its format from a header and rows of cells; jsonl leaves empty cells out at times. */
function tableText(rng: Rng, format: TableFormat, header: readonly string[], rows: readonly (readonly string[])[]): string {
  const eol = rng() < 0.3 ? "\r\n" : "\n";
  let text = rng() < 0.1 ? "\uFEFF" : "";
  if (format === "jsonl") {
    const lines = rows.map((row) => {
      const object: Record<string, unknown> = {};
      const order = header.map((_, index) => index).sort(() => rng() - 0.5);
      for (const index of order) {
        const cell = row[index] ?? "";
        if (cell === "" && rng() < 0.5) continue;
        object[header[index] as string] = cell !== "" && rng() < 0.5 && /^-?[0-9.]+$/.test(cell) ? Number(cell) : cell === "" ? null : cell;
      }
      return JSON.stringify(object);
    });
    text += (lines.length === 0 ? [JSON.stringify(Object.fromEntries(header.map((name) => [name, null])))] : lines).join(eol);
  } else {
    const sep = format === "csv" ? "," : "\t";
    const line = (cells: readonly string[]): string => cells.map((cell) => (format === "csv" ? csvField(cell) : cell.replace(/[\t\r\n]/g, ""))).join(sep);
    text += [line(header), ...rows.map(line)].join(eol);
  }
  if (rng() < 0.5) text += eol;
  if (rng() < 0.06) {
    // Broken on purpose: a stray quote, a lost field or a blank line.
    const at = Math.floor(rng() * text.length);
    text = text.slice(0, at) + pick(rng, ['"', "\n", "\r", "{"]) + text.slice(at);
  }
  return text;
}

test("U-202: seeded random tables, targets and rules give the same result, letter for letter", async () => {
  const rng = random(20202);
  const formats: TableFormat[] = ["csv", "tsv", "jsonl"];
  const ops: AggregateOp[] = ["sum", "count", "min", "max", "mean"];
  let held = 0;
  let notHeld = 0;
  let open = 0;
  for (let round = 0; round < 120; round += 1) {
    const sourceFormat = pick(rng, formats);
    const keys = ["a", "b", "c", "", "d e", "é", "a,b"];
    const rows = Array.from({ length: Math.floor(rng() * 30) }, () => [pick(rng, keys), numberCell(rng), numberCell(rng)]);
    const header = sourceFormat !== "jsonl" && rng() < 0.05 ? ["k", "v", "v"] : ["k", "v", "w"];
    const sourceText = tableText(rng, sourceFormat, header, rows);
    const source = ref(`f/r${round}.${sourceFormat}`, sourceFormat);
    await put(source.path, sourceText);

    const op = pick(rng, ops);
    const column = pick(rng, ["v", "w"]);
    // The right answers by the whole-table reading of before, so most targets agree and some do not.
    const parsed = parseTableV1(new TextDecoder().decode(new TextEncoder().encode(sourceText)), sourceFormat);
    const groups = new Map<string, { cells: { cell: string; dataRow: number }[] }>();
    const total: { cell: string; dataRow: number }[] = [];
    if (parsed.ok) {
      const at = findColumnV1(parsed.table, column);
      const keyAt = findColumnV1(parsed.table, "k");
      parsed.table.rows.forEach((cells, index) => {
        const cell = { cell: at.ok ? (cells[at.index] ?? "") : "", dataRow: index + 1 };
        total.push(cell);
        const key = keyAt.ok ? (cells[keyAt.index] ?? "") : "";
        if (key === "") return;
        const group = groups.get(key) ?? { cells: [] };
        group.cells.push(cell);
        groups.set(key, group);
      });
    }
    const shown = (cells: { cell: string; dataRow: number }[]): string => {
      const result = aggregateV1(cells, op);
      const value = result.ok ? result.value : 0;
      return rng() < 0.15 ? String(value + 1) : rng() < 0.05 ? pick(rng, ["", "n/a"]) : String(value);
    };
    const targetFormat = pick(rng, formats);
    const groupRows = [...groups.entries()].map(([key, group]) => [key, shown(group.cells), "note"]);
    if (rng() < 0.2 && groupRows.length > 0) groupRows.splice(Math.floor(rng() * groupRows.length), 1);
    if (rng() < 0.15 && groupRows.length > 0) groupRows.push([...(groupRows[0] as string[])]);
    if (rng() < 0.1) groupRows.push(["zz", "1", "x"]);
    if (rng() < 0.1) groupRows.push(["", "0", "x"]);
    const groupTarget = ref(`r/g${round}.${targetFormat}`, targetFormat);
    await put(groupTarget.path, tableText(rng, targetFormat, ["k", "total", "note"], groupRows));
    const totalTarget = ref(`r/t${round}.${targetFormat}`, targetFormat);
    await put(totalTarget.path, tableText(rng, targetFormat, ["total"], rng() < 0.1 ? [[shown(total)], ["1"]] : [[shown(total)]]));

    const rules = [
      sum(source, totalTarget, { op, column }),
      grouped(source, groupTarget, { op, column, ...(rng() < 0.3 ? { tolerance: { absolute: 0.5 } } : {}) }),
      shape(groupTarget, { columns: ["k", "total", "note"], rows: rng() < 0.5 ? { sameAs: source } : { min: 1 } }),
      shape(source, { columns: ["v", "k"], columnsMatch: "includes" }),
    ];
    const want = await runDataChecksVerifierV1({ id: "data", kind: "data_checks", rules } as unknown as DataChecksVerifierConfig, workspace, new AbortController().signal);
    for (const line of want.evidence.split("\n")) {
      if (line.startsWith("held")) held += 1;
      else if (line.startsWith("not held")) notHeld += 1;
      else open += 1;
    }
    await same(rules, `round ${round}`, undefined, RANDOM_CHUNKS);
  }
  // Every verdict occurs in the random cases (the comparison is not of one path only).
  assert.ok(held > 50 && notHeld > 50 && open > 20, `held ${held}, not held ${notHeld}, undecided ${open}`);
});
