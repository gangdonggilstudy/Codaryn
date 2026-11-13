/**
 * U-232 (bundle A, A-8 to come; proposal docs/reviews/2026-11-13-p1-bundle-proposal.md 3.1 "how the
 * guarantee is tested", DR-70): the tables and files a private data test puts under an unreadable
 * folder, with a marker in every cell that only one row holds, so that finding a marker anywhere a
 * model or a person can see means a row went there.
 *
 * - Markers are made at run time from random bytes: ASCII letters and digits with Hangul syllables
 *   in between, starting with a letter (never read as a number). None is written in the source, none
 *   is a part of another, and none holds a character that JSON, CSV or TSV would escape or quote.
 * - Each table has 16 data rows and the columns PRIVATE_COLUMNS:
 *   - person, contact, memo: a marker of that row only in every cell;
 *   - region: groups of 6, 5, 4 and 1 rows; team: groups of 7, 5, 3 and 1 rows; their key values are
 *     markers too, shared by the group's rows. Grouped by both, one group has 5 rows (the largest
 *     region with the largest team) and every other group fewer;
 *   - amount, age: whole numbers, different in every row, for count, sum and mean.
 * - With k = 5 (DEFAULT_MIN_GROUP_SIZE): the keys of the 6- and 5-row groups are shown by a query that
 *   groups by that one column (the positive control), the keys of the 4-, 3- and 1-row groups are
 *   never shown by any query, since a group of two columns is never larger than either column's.
 * - `writePrivateWorkspace` writes three such tables (CSV, TSV, JSON Lines, each with its own
 *   markers), a notes file with a marker on every line, a file and a folder whose names are markers
 *   (names under an unreadable path are hidden too, R-4), and a public guide with no marker.
 *
 * The oracle (`groupsOf`) is computed here, apart from src/tabular, so a test can compare the
 * product's numbers with it.
 */

import { randomInt } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_MIN_GROUP_SIZE } from "../../src/contracts/index.js";
import type { TableFormat } from "../../src/contracts/index.js";
import type { Sandbox } from "./builders.js";

export const PRIVATE_COLUMNS = ["person", "contact", "memo", "region", "team", "amount", "age"] as const;
export type PrivateColumn = (typeof PRIVATE_COLUMNS)[number];
/** The columns whose cells are markers of one row. */
export const ROW_MARKER_COLUMNS = ["person", "contact", "memo"] as const;
/** The columns a query may group by. */
export const GROUP_COLUMNS = ["region", "team"] as const;
export type GroupColumn = (typeof GROUP_COLUMNS)[number];
/** The columns with numbers. */
export const NUMBER_COLUMNS = ["amount", "age"] as const;

/** Row index → the index of its region group (sizes 6, 5, 4, 1) and team group (sizes 7, 5, 3, 1). */
const REGION_OF = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3] as const;
const TEAM_OF = [0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 2, 2, 2, 3] as const;
export const PRIVATE_ROWS = REGION_OF.length;

const ASCII = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const LETTERS = ASCII.slice(0, 52);
const HANGUL_FIRST = 0xac00;
const HANGUL_COUNT = 0xd7a3 - 0xac00 + 1;

/** Makes markers that are unique among themselves and none a part of another. */
export class MarkerMaker {
  private readonly made: string[] = [];

  /** 9 ASCII letters or digits (the first a letter) and 3 Hangul syllables at random places. */
  next(): string {
    for (;;) {
      const chars = [LETTERS[randomInt(LETTERS.length)] as string];
      for (let i = 0; i < 8; i += 1) chars.push(ASCII[randomInt(ASCII.length)] as string);
      for (let i = 0; i < 3; i += 1) chars.splice(1 + randomInt(chars.length), 0, String.fromCharCode(HANGUL_FIRST + randomInt(HANGUL_COUNT)));
      const marker = chars.join("");
      if (this.made.some((other) => other.includes(marker) || marker.includes(other))) continue;
      this.made.push(marker);
      return marker;
    }
  }

  /** Every marker made so far. */
  all(): readonly string[] {
    return this.made;
  }
}

export interface PrivateRow {
  readonly person: string;
  readonly contact: string;
  readonly memo: string;
  readonly region: string;
  readonly team: string;
  readonly amount: number;
  readonly age: number;
}

export interface PrivateTable {
  readonly rows: readonly PrivateRow[];
  /** The key values of each group column, by group: index 0 the largest group. */
  readonly keys: Readonly<Record<GroupColumn, readonly string[]>>;
}

/** A table of PRIVATE_ROWS rows with fresh markers (see the module's note). */
export function makePrivateTable(markers: MarkerMaker): PrivateTable {
  const regions = [markers.next(), markers.next(), markers.next(), markers.next()];
  const teams = [markers.next(), markers.next(), markers.next(), markers.next()];
  const rows = REGION_OF.map((region, index) => ({
    person: markers.next(),
    contact: markers.next(),
    memo: markers.next(),
    region: regions[region] as string,
    team: teams[TEAM_OF[index] as number] as string,
    amount: 1000 + 37 * index,
    age: 20 + ((index * 7) % 41),
  }));
  return { rows, keys: { region: regions, team: teams } };
}

/** The table's text in `format`: a header and one line per row (LF), or one JSON object per line. */
export function renderTable(table: PrivateTable, format: TableFormat): string {
  if (format === "jsonl") return table.rows.map((row) => `${JSON.stringify(row)}\n`).join("");
  const separator = format === "csv" ? "," : "\t";
  const lines = [PRIVATE_COLUMNS.join(separator), ...table.rows.map((row) => PRIVATE_COLUMNS.map((column) => String(row[column])).join(separator))];
  return `${lines.join("\n")}\n`;
}

/** The markers of one row only: the person, contact and memo cells of every row. */
export function rowMarkersOf(table: PrivateTable): string[] {
  return table.rows.flatMap((row) => ROW_MARKER_COLUMNS.map((column) => row[column]));
}

export interface OracleGroup {
  readonly keys: readonly string[];
  readonly rows: number;
  readonly sum: Readonly<Record<(typeof NUMBER_COLUMNS)[number], number>>;
}

/**
 * Every group of a query grouping by `groupBy` (0 to 2 columns), before any is hidden, in code unit
 * order of their keys compared key by key, with the row count and the sums (the mean is sum / rows).
 */
export function groupsOf(table: PrivateTable, groupBy: readonly GroupColumn[]): OracleGroup[] {
  const groups = new Map<string, { keys: string[]; rows: number; amount: number; age: number }>();
  for (const row of table.rows) {
    const keys = groupBy.map((column) => row[column]);
    const id = JSON.stringify(keys);
    const group = groups.get(id) ?? { keys, rows: 0, amount: 0, age: 0 };
    group.rows += 1;
    group.amount += row.amount;
    group.age += row.age;
    groups.set(id, group);
  }
  const compare = (a: readonly string[], b: readonly string[]): number => {
    for (let i = 0; i < a.length; i += 1) {
      const x = a[i] as string;
      const y = b[i] as string;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  };
  return [...groups.values()].sort((a, b) => compare(a.keys, b.keys)).map((group) => ({ keys: group.keys, rows: group.rows, sum: { amount: group.amount, age: group.age } }));
}

/** The key values a query grouping by `groupBy` shows with group size `k`. */
export function shownKeysOf(table: PrivateTable, groupBy: readonly GroupColumn[], k: number): string[] {
  return [...new Set(groupsOf(table, groupBy).filter((group) => group.rows >= k).flatMap((group) => group.keys))];
}

/** Key values no query shows with group size `k`: those whose own column's group has fewer than k rows. */
export function neverShownKeysOf(table: PrivateTable, k: number): string[] {
  return GROUP_COLUMNS.flatMap((column) => groupsOf(table, [column]).filter((group) => group.rows < k).flatMap((group) => group.keys));
}

/** Key values a query grouping by that one column shows with group size `k` (the positive control). */
export function singleColumnShownKeysOf(table: PrivateTable, k: number): string[] {
  return GROUP_COLUMNS.flatMap((column) => shownKeysOf(table, [column], k));
}

export interface PrivateTableFile {
  /** Relative to the workspace root, with `/`. */
  readonly path: string;
  readonly format: TableFormat;
  readonly table: PrivateTable;
}

export interface PrivateCanary {
  /** The unreadable folder, relative to the workspace root. */
  readonly dir: string;
  /** The group size the sets below are for. */
  readonly k: number;
  readonly tables: readonly PrivateTableFile[];
  /** The markers on the notes file's lines and in the named file. */
  readonly fileMarkers: readonly string[];
  /** Every marker of one row or one line: the tables' row cells and fileMarkers. */
  readonly rowMarkers: readonly string[];
  /** The names under `dir` that are markers (a file's and a folder's). */
  readonly nameMarkers: readonly string[];
  /** Key values of groups of fewer than k rows, in every table: no query shows them. */
  readonly smallKeys: readonly string[];
  /** Key values a single-column query shows, in every table: present wherever groups are given. */
  readonly largeKeys: readonly string[];
  /** Files outside `dir` (no marker in them). */
  readonly publicFiles: readonly string[];
}

export interface PrivateWorkspaceOptions {
  /** The unreadable folder. Default "private". */
  readonly dir?: string;
  /** The group size. Default DEFAULT_MIN_GROUP_SIZE. */
  readonly k?: number;
}

function write(root: string, relative: string, text: string): void {
  const full = path.join(root, ...relative.split("/"));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text);
}

/**
 * Writes under the sandbox's workspace:
 * - `<dir>/people.csv`, `<dir>/people.tsv`, `<dir>/people.jsonl`: a table each, each with its own markers;
 * - `<dir>/notes.txt`: five lines, a marker on each;
 * - `<dir>/<name marker>.txt` holding one marker, and `<dir>/cases/<name marker>/info.md` holding one;
 * - `public/guide.md`: no marker.
 */
export function writePrivateWorkspace(sandbox: Sandbox, options: PrivateWorkspaceOptions = {}): PrivateCanary {
  const dir = options.dir ?? "private";
  const k = options.k ?? DEFAULT_MIN_GROUP_SIZE;
  const markers = new MarkerMaker();
  const tables: PrivateTableFile[] = (["csv", "tsv", "jsonl"] as const).map((format) => ({ path: `${dir}/people.${format}`, format, table: makePrivateTable(markers) }));
  for (const file of tables) write(sandbox.workspace, file.path, renderTable(file.table, file.format));
  const notes = [markers.next(), markers.next(), markers.next(), markers.next(), markers.next()];
  write(sandbox.workspace, `${dir}/notes.txt`, notes.map((marker, index) => `note ${index + 1}: ${marker}\n`).join(""));
  const fileName = markers.next();
  const folderName = markers.next();
  const inFile = markers.next();
  const inFolder = markers.next();
  write(sandbox.workspace, `${dir}/${fileName}.txt`, `${inFile}\n`);
  write(sandbox.workspace, `${dir}/cases/${folderName}/info.md`, `# case\n\n${inFolder}\n`);
  write(sandbox.workspace, "public/guide.md", "# Guide\n\nThe tables are under the private folder. Report only totals by group.\n");
  const fileMarkers = [...notes, inFile, inFolder];
  return {
    dir,
    k,
    tables,
    fileMarkers,
    rowMarkers: [...tables.flatMap((file) => rowMarkersOf(file.table)), ...fileMarkers],
    nameMarkers: [fileName, folderName],
    smallKeys: tables.flatMap((file) => neverShownKeysOf(file.table, k)),
    largeKeys: tables.flatMap((file) => singleColumnShownKeysOf(file.table, k)),
    publicFiles: ["public/guide.md"],
  };
}
