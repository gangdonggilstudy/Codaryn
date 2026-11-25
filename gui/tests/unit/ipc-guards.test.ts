/** IPC source boundaries and the common character policy. No compiler API or runtime loading. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface Token { readonly kind: "word" | "string" | "punct"; readonly value: string; readonly at: number }
export interface ModuleReference { readonly specifier: string; readonly at: number; readonly calculated: boolean }
export interface SourceFile { readonly file: string; readonly text: string }

/** Read literal escapes without executing source text. */
function decoded(value: string): string {
  return value.replace(/\\(?:u\{([0-9a-f]+)\}|u([0-9a-f]{4})|x([0-9a-f]{2})|(\r?\n)|([\s\S]))/gi, (_all, point: string | undefined, unit: string | undefined, byte: string | undefined, continuation: string | undefined, other: string | undefined) => {
    if (point !== undefined) return String.fromCodePoint(Number.parseInt(point, 16));
    if (unit !== undefined || byte !== undefined) return String.fromCharCode(Number.parseInt(unit ?? byte!, 16));
    if (continuation !== undefined) return "";
    return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" } as Record<string, string>)[other!] ?? other!;
  });
}

/** Skip comments and regex literals; keep module strings and template interpolations separate. */
function tokens(source: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const scan = (interpolation = false): void => {
    let braces = 0;
    while (i < source.length) {
      const c = source[i]!;
      if (/\s/.test(c)) { i++; continue; }
      if (source.startsWith("//", i)) { while (i < source.length && source[i] !== "\n") i++; continue; }
      if (source.startsWith("/*", i)) { const end = source.indexOf("*/", i + 2); assert.ok(end >= 0, "unterminated comment"); i = end + 2; continue; }
      if (c === "}" && interpolation && braces === 0) { i++; return; }
      if (c === "{" ) braces++;
      if (c === "}") braces--;
      if (c === "'" || c === '"' || c === "`") {
        const quote = c, at = i++;
        let raw = "";
        while (i < source.length) {
          if (source[i] === "\\") { raw += source.slice(i, i + 2); i += 2; continue; }
          if (source[i] === quote) { i++; break; }
          if (quote === "`" && source.startsWith("${", i)) {
            out.push({ kind: "string", value: decoded(raw), at }); raw = "";
            out.push({ kind: "punct", value: "+", at: i }); i += 2; scan(true);
            out.push({ kind: "punct", value: "+", at: i }); continue;
          }
          raw += source[i++];
        }
        out.push({ kind: "string", value: decoded(raw), at }); continue;
      }
      const previous = out.at(-1)?.value;
      if (c === "/" && (previous === undefined || ["=", "(", "[", ",", ":", "return", "=>", "!", "&&", "||"].includes(previous))) {
        i++; let inClass = false;
        while (i < source.length) {
          const r = source[i++];
          if (r === "\\") { i++; continue; }
          if (r === "[") inClass = true;
          if (r === "]") inClass = false;
          if (r === "/" && !inClass) break;
        }
        while (/[a-z]/i.test(source[i] ?? "")) i++;
        continue;
      }
      if (/[a-z_$]/i.test(c)) {
        const at = i++; while (/[\w$]/.test(source[i] ?? "")) i++;
        out.push({ kind: "word", value: source.slice(at, i), at }); continue;
      }
      out.push({ kind: "punct", value: c, at: i++ });
    }
  };
  scan(); return out;
}

/** Literal import/export/require addresses, including import type and folded literal joins. */
export function moduleReferences(source: string): ModuleReference[] {
  const ts = tokens(source), refs: ModuleReference[] = [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i]!;
    if (t.kind !== "word" || !["import", "export", "require"].includes(t.value)) continue;
    if (t.value === "import" && ts[i + 1]?.value === ".") continue;
    if (ts[i + 1]?.value === "(" && t.value !== "export") {
      let depth = 0, j = i + 2;
      for (; j < ts.length; j++) { const value = ts[j]!.value; if (value === "(" || value === "[") depth++; if ((value === ")" || value === ",") && depth === 0) break; if (value === ")" || value === "]") depth--; }
      const arg = ts.slice(i + 2, j), literal = arg.length > 0 && arg.every((v, n) => n % 2 === 0 ? v.kind === "string" : v.value === "+");
      const strings = arg.filter(v => v.kind === "string");
      if (literal) refs.push({ specifier: strings.map(s => s.value).join(""), at: t.at, calculated: false });
      else for (const s of strings) refs.push({ specifier: s.value, at: t.at, calculated: true });
      continue;
    }
    if (t.value === "require") continue;
    if (t.value === "import" && ts[i + 1]?.kind === "string") { refs.push({ specifier: ts[i + 1]!.value, at: t.at, calculated: false }); continue; }
    if (t.value === "export" && !["{", "*", "type"].includes(ts[i + 1]?.value ?? "")) continue;
    for (let j = i + 1; j < ts.length && ts[j]!.value !== ";"; j++) {
      if (ts[j]!.value === "from" && ts[j + 1]?.kind === "string") { refs.push({ specifier: ts[j + 1]!.value, at: t.at, calculated: false }); break; }
      if (["import", "export"].includes(ts[j]!.value)) break;
    }
  }
  return refs;
}

export function readSources(root: string): SourceFile[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    assert.ok(!entry.isSymbolicLink(), `source symlink needs review: ${entry.name}`);
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) return readSources(file);
    return entry.isFile() && /\.(?:[cm]?[jt]sx?)$/.test(entry.name) ? [{ file, text: readFileSync(file, "utf8") }] : [];
  });
}

const inside = (root: string, target: string): boolean => { const rel = path.relative(root, target); return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel)); };
export function ipcBoundaryViolations(root: string, sources: readonly SourceFile[] = readSources(root)): string[] {
  const shared = path.join(root, "shared"), internal = path.join(shared, "ipc"), facade = path.join(shared, "ipc.ts"), failures: string[] = [];
  for (const source of sources) for (const ref of moduleReferences(source.text)) {
    const spec = ref.specifier.replace(/\\/g, "/"), own = inside(internal, source.file);
    const target = spec.startsWith("file:") ? fileURLToPath(new URL(spec)) : spec.startsWith(".") || path.isAbsolute(spec) ? path.resolve(path.dirname(source.file), spec) : null;
    const deep = target !== null && inside(internal, target) || /(?:^|\/)shared\/ipc\//.test(spec);
    const line = source.text.slice(0, ref.at).split("\n").length;
    const fail = (reason: string): void => { failures.push(`${path.relative(root, source.file).replace(/\\/g, "/")}:${line}: ${reason}: ${spec}`); };
    if (!own) { if (deep && source.file !== facade) fail("use shared/ipc.js facade"); continue; }
    const from = path.basename(source.file).replace(/\.[^.]+$/, ""), to = target === null ? null : path.basename(target).replace(/\.[^.]+$/, "");
    const leaf = from === "cleanup-replies" && target === path.join(shared, "cleanup.js");
    const allowed = !ref.calculated && target !== null && (leaf || inside(internal, target) && (from === "core" ? to === "primitives" : from !== "primitives" && ["core", "primitives"].includes(to ?? "")));
    if (!allowed) fail("IPC dependency direction");
  }
  return failures;
}

export function assertIpcBoundaries(root: string, sources?: readonly SourceFile[]): void {
  assert.deepEqual(ipcBoundaryViolations(root, sources), [], "IPC imports must preserve facade and dependency directions");
}

type LoaderKind = "import" | "require" | "createRequire";
export interface CalculatedLoad { readonly kind: LoaderKind; readonly at: number }

/** Nonliteral calls and loader factory references need review, even without module string fragments. */
export function calculatedLoads(source: string): CalculatedLoad[] {
  const ts = tokens(source), loads: CalculatedLoad[] = [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i]!;
    const member = ts[i - 1]?.value === "[" && ts[i + 1]?.value === "]" && (ts[i - 2]?.kind === "word" || [")", "]"].includes(ts[i - 2]?.value ?? ""));
    // Factory imports (including aliases), property access and calls are reviewed as a whole.
    if (t.value === "createRequire" && (t.kind === "word" || t.kind === "string" && member)) { loads.push({ kind: "createRequire", at: t.at }); continue; }
    if (t.kind !== "word" || (t.value !== "import" && t.value !== "require")) continue;
    if (ts[i + 1]?.value !== "(") {
      // Taking a require alias or an optional reference must not hide a later computed call.
      if (t.value === "require") loads.push({ kind: "require", at: t.at });
      continue;
    }
    let depth = 0, end = i + 2;
    for (; end < ts.length; end++) {
      const next = ts[end]!;
      if (next.kind !== "punct") continue;
      if ((next.value === ")" || next.value === ",") && depth === 0) break;
      if (["(", "[", "{"].includes(next.value)) depth++;
      if ([")", "]", "}"].includes(next.value)) depth--;
    }
    const argument = ts.slice(i + 2, end);
    if (argument.length !== 1 || argument[0]!.kind !== "string") loads.push({ kind: t.value, at: t.at });
  }
  return loads;
}

/** The two engine dist loaders in main.ts are the only reviewed computed addresses. */
const CALCULATED_LOAD_ALLOWLIST = { "engine-host/main.ts": { import: 2, require: 0, createRequire: 0 } };
export function assertCalculatedLoadAllowlist(root: string, sources: readonly SourceFile[] = readSources(root)): void {
  const actual: Record<string, Record<LoaderKind, number>> = {};
  for (const source of sources) {
    const loads = calculatedLoads(source.text);
    if (loads.length === 0) continue;
    const counts = { import: 0, require: 0, createRequire: 0 };
    for (const load of loads) counts[load.kind]++;
    actual[path.relative(root, source.file).replace(/\\/g, "/")] = counts;
  }
  assert.deepEqual(actual, CALCULATED_LOAD_ALLOWLIST, "calculated module loaders require review of the file and counts");
}

const REJECTED_CHARACTER_RANGES = [[0, 8], [0xb, 0x1f], [0x7f, 0x9f], [0x61c, 0x61c], [0x200e, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069]] as const;
type CharacterCheck = (value: unknown) => { readonly ok: boolean };

/** Every allowed BMP unit goes through both public paths in bounded batches; rejects go individually. */
export function assertBmpCharacterPolicy(textReply: CharacterCheck, runResult: CharacterCheck, maxBatchUnits: number) {
  assert.ok(Number.isSafeInteger(maxBatchUnits) && maxBatchUnits > 0);
  const allowed: number[] = [], rejected: number[] = [];
  for (let cp = 0; cp <= 0xffff; cp++) (REJECTED_CHARACTER_RANGES.some(([first, last]) => cp >= first && cp <= last) ? rejected : allowed).push(cp);
  const check = (text: string, expected: boolean, label: string): void => {
    const opened = textReply({ ok: true, status: "opened", text, masked: false, protected: false, editable: true, readOnlyReasons: [], digest: "a".repeat(64), lineEnding: text.includes("\n") ? "lf" : "none", bom: false, bytes: Buffer.byteLength(text) });
    const result = runResult({ ok: true, result: { runId: "20261112T010203Z-0000abcd", status: "done", reason: "verified", exitCode: 0, changes: [], verifiers: [], usage: { turns: 0, tools: 0, inputTokens: 0, outputTokens: 0, durationMs: 0 }, notices: [], plan: null, review: null, protectedChanged: null, finalMessage: { text, truncated: false } } });
    assert.deepEqual({ text: opened.ok, message: result.ok }, { text: expected, message: expected }, label);
  };
  for (const cp of rejected) check(String.fromCharCode(cp), false, `rejected BMP U+${cp.toString(16)}`);
  let batches = 0;
  for (let offset = 0; offset < allowed.length; offset += maxBatchUnits) {
    const batch = allowed.slice(offset, offset + maxBatchUnits);
    check(batch.map(cp => String.fromCharCode(cp)).join(""), true, `allowed BMP batch U+${batch[0]!.toString(16)}..U+${batch.at(-1)!.toString(16)}`);
    batches++;
  }
  return { codePoints: allowed.length + rejected.length, surrogateCodePoints: 0x800, allowed: allowed.length, rejected: rejected.length, batches, predicateCalls: (rejected.length + batches) * 2 };
}

// Registered tests below; the offline mutation probe copies the exact compiled functions above.
import { test } from "node:test";
import { MAX_FINAL_MESSAGE_CHARS, MAX_TEXT_CHARS, toTextReply, toRunResultView } from "../../src/shared/ipc.js";
const GUI = fileURLToPath(new URL("../../../", import.meta.url)), SRC = path.join(GUI, "src");

test("IPC guards: all GUI source consumers use the facade, with no domain-to-domain imports", () => {
  assertIpcBoundaries(SRC);
});

test("IPC guards: static, dynamic, require and type imports cannot reach internal modules", () => {
  const examples = [
    'import { isObj } from "../shared/ipc/primitives.js";',
    'import type { Obj } from "../shared/ipc/primitives.js";',
    'import "../shared/ipc/core.js";',
    'await import("../shared/ipc/core.js");',
    'await import(`../shared/ipc/core.js`);',
    'require("../shared/ipc/core.js");',
    'import x = require("../shared/ipc/core.js");',
    'export { isObj } from "../shared/ipc/primitives.js";',
    'import /* gap */ type { Obj }\nfrom "../shared/./ipc/primitives.js";',
    'await import("../shared/" + "ipc/core.js");',
    'await import("../shared/\\u0069pc/core.js");',
    'const label = `${await import("../shared/ipc/core.js")}`;',
  ];
  for (const text of examples) assert.throws(() => assertIpcBoundaries(SRC, [{ file: path.join(SRC, "main", "example.ts"), text }]), /facade/);
});

test("IPC guards: shared siblings and internal imports obey the same source rules", () => {
  for (const [file, text, rejected] of [
    ["shared/other.ts", 'import "./ipc/core.js";', true],
    ["shared/ipc.ts", 'export { isObj } from "./ipc/primitives.js";', false],
    ["main/example.ts", 'import { hostCodeOf } from "../shared/ipc.js";', false],
    ["shared/ipc/text.ts", 'import type { SettingsView } from "./settings.js";', true],
    ["shared/ipc/core.ts", 'import "./run.js";', true],
    ["shared/ipc/primitives.ts", 'import "./core.js";', true],
    ["shared/ipc/text.ts", 'import "../ipc.js";', true],
    ["shared/ipc/text.ts", 'import "./primitives.js";', false],
    ["shared/ipc/run.ts", 'import type { RunItemView } from "./core.js";', false],
    ["shared/ipc/cleanup-replies.ts", 'import "../cleanup.js";', false],
  ] as const) assert.equal(ipcBoundaryViolations(SRC, [{ file: path.join(SRC, file), text }]).length > 0, rejected, file);
});

test("IPC guards: comments, ordinary strings and regex text do not become imports", () => {
  const text = '// import "../shared/ipc/core.js";\n/* require("../shared/ipc/core.js") */\nconst text = \'import "../shared/ipc/core.js";\';\nconst pattern = /import\\("..\\/shared\\/ipc\\/core.js"\\)/;';
  assertIpcBoundaries(SRC, [{ file: path.join(SRC, "main", "example.ts"), text }]);
});

test("IPC guards: calculated loaders are confined to the reviewed file and counts", () => {
  assertCalculatedLoadAllowlist(SRC);
});

test("IPC guards: nonliteral imports, require aliases and loader factories cannot silently widen the allowlist", () => {
  const file = path.join(SRC, "engine-host", "main.ts"), known = { file, text: readFileSync(file, "utf8") };
  const examples = [
    'await import(join(dir, "ipc", "core.js"));', 'await import(target);', 'await import(`${dir}/core.js`);',
    'require(join(dir, name));', 'module.require(target);', 'const load = require; load(target);',
    'createRequire(import.meta.url)(target);', 'import { createRequire as load } from "node:module"; load(import.meta.url)(target);',
    'module["createRequire"](import.meta.url)(target);',
  ];
  for (const text of examples) {
    assert.ok(calculatedLoads(text).length > 0, text);
    assert.throws(() => assertCalculatedLoadAllowlist(SRC, [known, { file: path.join(SRC, "main", "example.ts"), text }]), /calculated module loaders/);
  }
  assert.throws(() => assertCalculatedLoadAllowlist(SRC, [{ file, text: known.text + "\nimport(target);" }]), /calculated module loaders/, "the allowed file cannot add a third site");
  assert.throws(() => assertCalculatedLoadAllowlist(SRC, []), /calculated module loaders/, "removing a known loader also requires review");
  assert.deepEqual(calculatedLoads('import("./ipc.js"); import(`./ipc.js`); require("electron"); // import(target)\nconst label = "createRequire(target)";'), []);
});

test("IPC characters: both public paths accept exactly the BMP character set", t => {
  const started = performance.now();
  const stats = assertBmpCharacterPolicy(toTextReply, toRunResultView, Math.min(4096, MAX_FINAL_MESSAGE_CHARS, MAX_TEXT_CHARS));
  assert.equal(stats.codePoints, 65_536);
  assert.equal(stats.rejected, 77);
  assert.equal(stats.allowed, 65_459);
  t.diagnostic(JSON.stringify({ check: "IG-2 BMP", ...stats, elapsedMs: performance.now() - started }));
});

test("IPC characters: text view and final messages share the control/direction policy at boundaries", () => {
  const ranges = REJECTED_CHARACTER_RANGES;
  const points = new Set([9, 10, 0x20, 0x61b, 0x61d, 0x200d, 0x2010, 0x2027, 0x202f, 0x2065, 0x206a, 0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000, 0xffff, 0x10000, 0x10ffff]);
  for (const [first, last] of ranges) for (let cp = Math.max(0, first - 1); cp <= last + 1; cp++) points.add(cp);
  for (const cp of points) {
    const text = String.fromCodePoint(cp), rejected = ranges.some(([first, last]) => cp >= first && cp <= last);
    const opened = toTextReply({ ok: true, status: "opened", text, masked: false, protected: false, editable: true, readOnlyReasons: [], digest: "a".repeat(64), lineEnding: cp === 10 ? "lf" : "none", bom: false, bytes: Buffer.byteLength(text) });
    const result = toRunResultView({ ok: true, result: { runId: "20261112T010203Z-0000abcd", status: "done", reason: "verified", exitCode: 0, changes: [], verifiers: [], usage: { turns: 0, tools: 0, inputTokens: 0, outputTokens: 0, durationMs: 0 }, notices: [], plan: null, review: null, protectedChanged: null, finalMessage: { text, truncated: false } } });
    assert.equal(opened.ok, !rejected, `text U+${cp.toString(16)}`);
    assert.equal(result.ok, !rejected, `message U+${cp.toString(16)}`);
  }
});
