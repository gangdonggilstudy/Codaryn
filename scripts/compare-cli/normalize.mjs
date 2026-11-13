// U-130: normalization and line diff for scripts/compare-cli-boards.mjs.
//
// Only values that differ between any two runs of the same build are replaced, everything else is
// compared character by character:
// - the case folder and the build folder (both sides run in the same folder, but a build's own
//   folder differs), in their forward, backslash and JSON-escaped forms -> <CASE>, <BOARD>
// - run ids (YYYYMMDDTHHMMSSZ-xxxxxxxx) -> <RUN-1>, <RUN-2>, ... by first appearance
// - plan digests (the value of a "digest" field: plan.json names its run, so its hash differs per
//   run) and their 12-character prefixes -> <DIGEST-n>, <DIGEST-n:12>; other hashes are kept
// - privacy tokens (random per run) -> <TOKEN-n> by first appearance
// - ISO times and local times (YYYY-MM-DD HH:MM:SS) -> <TIME>; "durationMs" values, report's
//   "Duration: N ms of" and the end summary's "· N s" / "· N초" -> <MS>, <S>; a lock's "pid" -> <PID>
// Labels by first appearance keep the structure: two runs that make the same records in the same
// order get the same labels, and a value that appears in another place shows up as a difference.

const RUN_ID = /\b\d{8}T\d{6}Z-[0-9a-f]{8}\b/g;
const TOKEN = /\[\[CODARYN_SECRET:[0-9a-f]{16}\]\]/g;
const ISO_TIME = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g;
const LOCAL_TIME = /\b\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\b/g;
const DURATION = /("durationMs"\s*:\s*)\d+/g;
const REPORT_DURATION = /(Duration: )\d+( ms of )/g;
const SUMMARY_SECONDS = /(· )\d+(?:\.\d+)?( s\b|초)/g;
const PID = /("pid"\s*:\s*)\d+/g;
const DIGEST_FIELD = /"digest"\s*:\s*"([0-9a-f]{64})"/g;

/** The forms a folder path takes in output: as given, with / or \, JSON-escaped once or twice, the drive letter in either case. */
export function pathForms(folder) {
  const forms = new Set();
  const add = (value) => {
    if (value.length === 0) return;
    forms.add(value);
    if (/^[A-Za-z]:/.test(value)) {
      forms.add(value[0].toLowerCase() + value.slice(1));
      forms.add(value[0].toUpperCase() + value.slice(1));
    }
  };
  const slash = folder.replace(/\\/g, "/");
  const back = folder.replace(/\//g, "\\");
  add(slash);
  add(back);
  add(back.replace(/\\/g, "\\\\"));
  add(back.replace(/\\/g, "\\\\\\\\"));
  return [...forms].sort((a, b) => b.length - a.length);
}

function replacePaths(text, paths) {
  let out = text;
  for (const { forms, label } of paths) for (const form of forms) out = out.split(form).join(label);
  return out;
}

/**
 * Normalizes one side of a case: `artifacts` is an ordered list of { key, text } (text null for a
 * file that is not text). Keys are normalized like texts (run directories hold run ids). Returns a
 * Map from normalized key to normalized text, in the same order.
 */
export function normalizeSide(artifacts, { paths = [] } = {}) {
  const stage1 = artifacts.map(({ key, text }) => ({ key: replacePaths(key, paths), text: text === null ? null : replacePaths(text, paths) }));
  const runs = new Map();
  const tokens = new Map();
  const digests = new Map();
  const label = (map, value, prefix) => {
    if (!map.has(value)) map.set(value, `<${prefix}-${map.size + 1}>`);
    return map.get(value);
  };
  // Labels follow the order of appearance over keys and texts, in artifact order.
  for (const { key, text } of stage1) {
    for (const source of [key, text ?? ""]) {
      for (const match of source.matchAll(RUN_ID)) label(runs, match[0], "RUN");
      for (const match of source.matchAll(DIGEST_FIELD)) label(digests, match[1], "DIGEST");
      for (const match of source.matchAll(TOKEN)) label(tokens, match[0], "TOKEN");
    }
  }
  const apply = (source) => {
    let out = source.replace(RUN_ID, (value) => runs.get(value) ?? value).replace(TOKEN, (value) => tokens.get(value) ?? value);
    for (const [digest, name] of digests) {
      out = out.split(digest).join(name);
      out = out.replace(new RegExp(`(?<![0-9a-f])${digest.slice(0, 12)}(?![0-9a-f])`, "g"), `${name.slice(0, -1)}:12>`);
    }
    return out
      .replace(ISO_TIME, "<TIME>")
      .replace(LOCAL_TIME, "<TIME>")
      .replace(DURATION, "$1<MS>")
      .replace(REPORT_DURATION, "$1<MS>$2")
      .replace(SUMMARY_SECONDS, "$1<S>$2")
      .replace(PID, "$1<PID>");
  };
  const result = new Map();
  for (const { key, text } of stage1) result.set(apply(key), text === null ? null : apply(text));
  return result;
}

/** Longest common subsequence of two line lists, as the indexes kept from each. */
function lcs(a, b) {
  const n = a.length;
  const m = b.length;
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) i += 1;
    else j += 1;
  }
  return pairs;
}

/** Where two lines first differ, and a window of each around it (long JSON lines). */
export function firstDifference(a, b, width = 160) {
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at += 1;
  const from = Math.max(0, at - 40);
  const cut = (line) => `${from > 0 ? "…" : ""}${line.slice(from, from + width)}${line.length > from + width ? "…" : ""}`;
  return { column: at + 1, base: cut(a), head: cut(b) };
}

/**
 * The lines that differ between two texts: removed (only in base) and added (only in head), with
 * 1-based line numbers. A removed line followed by an added one at the same place is reported as a
 * change with the first differing column. Texts up to `limit` lines each are diffed line by line;
 * longer ones report the first differing line only.
 */
export function diffLines(baseText, headText, limit = 4000) {
  const a = baseText.split("\n");
  const b = headText.split("\n");
  if (a.length > limit || b.length > limit) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
    return [{ kind: "change", baseLine: i + 1, headLine: i + 1, ...firstDifference(a[i] ?? "", b[i] ?? "") }];
  }
  const pairs = lcs(a, b);
  const out = [];
  let i = 0;
  let j = 0;
  const flush = (untilI, untilJ) => {
    const removed = [];
    const added = [];
    for (; i < untilI; i += 1) removed.push(i);
    for (; j < untilJ; j += 1) added.push(j);
    const both = Math.min(removed.length, added.length);
    for (let k = 0; k < both; k += 1) out.push({ kind: "change", baseLine: removed[k] + 1, headLine: added[k] + 1, ...firstDifference(a[removed[k]], b[added[k]]) });
    for (const index of removed.slice(both)) out.push({ kind: "removed", baseLine: index + 1, base: a[index] });
    for (const index of added.slice(both)) out.push({ kind: "added", headLine: index + 1, head: b[index] });
  };
  for (const [pi, pj] of pairs) {
    flush(pi, pj);
    i = pi + 1;
    j = pj + 1;
  }
  flush(a.length, b.length);
  return out;
}

/** Compares two normalized sides (Maps of key -> text). Returns the artifacts that differ, in key order of base then head. */
export function compareSides(base, head) {
  const keys = [...base.keys(), ...[...head.keys()].filter((key) => !base.has(key))];
  const found = [];
  for (const key of keys) {
    if (!head.has(key)) {
      found.push({ key, kind: "only-base" });
      continue;
    }
    if (!base.has(key)) {
      found.push({ key, kind: "only-head" });
      continue;
    }
    const a = base.get(key);
    const b = head.get(key);
    if (a === b) continue;
    if (a === null || b === null) {
      found.push({ key, kind: "differ", lines: [{ kind: "change", baseLine: 1, headLine: 1, column: 1, base: a === null ? "(not text)" : "(text)", head: b === null ? "(not text)" : "(text)" }] });
      continue;
    }
    found.push({ key, kind: "differ", lines: diffLines(a, b) });
  }
  return found;
}
