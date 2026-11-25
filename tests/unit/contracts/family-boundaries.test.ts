/**
 * Family boundaries (IR-26 step 3): the modules split out of one file form a family around the file
 * that kept the old path (the facade). A family's members are found by listing, so a new member
 * (P2's plan-apply.ts, P3's plan-output.ts) is covered without a change here. No compiler API or
 * runtime loading. (1) A member other than the facade never imports its facade. (2) A domain module
 * imports no member of its family but the core; the composition layer may import domain modules
 * with type-only statements. (3) The core imports no other member. (4) src and gui/src outside a
 * family reach it through its facade only. (5) No `export *` in a family. (6) Each name the facade
 * exports is declared in at most one member. The app family's type-only rule is app-boundaries'.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The tokenizer, module references and source reading below are copied unchanged from
// tests/unit/contracts/app-boundaries.test.ts (which has them from gui/tests/unit/ipc-guards.test.ts).
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

export interface Family {
  readonly name: string;
  /** The family's folder, relative to the repository root. */
  readonly dir: string;
  /** The file that kept the old path. Members are it and `<its name>-<name>.ts` in the same folder. */
  readonly facade: string;
  readonly core: string | null;
  /** Members that may import domain modules with type-only statements (the composition layer). */
  readonly composition: readonly string[];
}

export const FAMILIES: readonly Family[] = [
  { name: "app", dir: "src/contracts", facade: "app.ts", core: "app-core.ts", composition: [] },
  { name: "engine", dir: "src/contracts", facade: "engine.ts", core: null, composition: [] },
  { name: "plan", dir: "src/contracts", facade: "plan.ts", core: "plan-core.ts", composition: ["plan-output.ts"] },
  { name: "task", dir: "src/app/input", facade: "task.ts", core: "task-core.ts", composition: [] },
  { name: "output", dir: "src/cli/human", facade: "output.ts", core: "output-layout.ts", composition: [] },
];

/** Rule (4)'s known exceptions ("importer -> member"), when the guard was written. Only new ones fail. */
export const OUTSIDE_ALLOWED: readonly string[] = [];

type Role = "facade" | "core" | "domain" | "composition";
export interface Member { readonly family: Family; readonly role: Role; readonly key: string; readonly file: string; readonly text: string }
/** The repository, and files (by repository-relative path) added or replaced in place of the real ones. */
export interface Tree { readonly repo: string; readonly extra?: ReadonlyMap<string, string> }

const relativePath = (repo: string, file: string): string => path.relative(repo, file).replace(/\\/g, "/");
const withoutExtension = (file: string): string => file.replace(/\.(?:[cm]?[jt]sx?)$/, "");
const lineOf = (text: string, at: number): number => text.slice(0, at).split("\n").length;

export function familyMembers(tree: Tree): Member[] {
  const members: Member[] = [];
  for (const family of FAMILIES) {
    const pattern = new RegExp(`^${family.facade.replace(/\.ts$/, "")}-[a-z0-9][a-z0-9-]*\\.ts$`);
    const belongs = (name: string): boolean => name === family.facade || pattern.test(name);
    const names = new Set<string>();
    for (const entry of readdirSync(path.join(tree.repo, family.dir), { withFileTypes: true })) {
      if (!belongs(entry.name)) continue;
      assert.ok(entry.isFile() && !entry.isSymbolicLink(), `${family.name} member needs review: ${entry.name}`);
      names.add(entry.name);
    }
    for (const key of tree.extra?.keys() ?? []) if (path.posix.dirname(key) === family.dir && belongs(path.posix.basename(key))) names.add(path.posix.basename(key));
    assert.ok(names.has(family.facade), `${family.name}: no facade ${family.facade}`);
    if (family.core !== null) assert.ok(names.has(family.core), `${family.name}: no core ${family.core}`);
    for (const name of [...names].sort()) {
      const key = `${family.dir}/${name}`;
      const role: Role = name === family.facade ? "facade" : name === family.core ? "core" : family.composition.includes(name) ? "composition" : "domain";
      members.push({ family, role, key, file: path.join(tree.repo, key), text: tree.extra?.get(key) ?? readFileSync(path.join(tree.repo, key), "utf8") });
    }
  }
  return members;
}

/** Where a module address points: a repository-relative path without its extension (dist/ stands for its source), or null. */
export function addressed(repo: string, fromFile: string, specifier: string): string | null {
  const spec = specifier.replace(/\\/g, "/").split(/[?#]/, 1)[0]!;
  const target = spec.startsWith("file:") ? fileURLToPath(new URL(spec)) : spec.startsWith(".") || path.isAbsolute(spec) ? path.resolve(path.dirname(fromFile), spec) : null;
  if (target === null) return null;
  const relative = relativePath(repo, target);
  return withoutExtension(relative.startsWith("dist/") ? relative.slice("dist/".length) : relative);
}

/** Whether the import or export at `at` is a statement-level `import type` / `export type` (erased whole). */
function typeOnly(ts: readonly Token[], at: number): boolean {
  const i = ts.findIndex(t => t.at === at);
  return i >= 0 && ts[i + 1]?.value === "type" && !["from", "=", ","].includes(ts[i + 2]?.value ?? "");
}

const DECLARATION = new Set(["const", "let", "var", "function", "class", "interface", "type", "enum"]);
/** The name a declaration starting at token `n` declares (after `declare`, `abstract` or `async`), or null. */
function declaredName(ts: readonly Token[], n: number): string | null {
  while (["declare", "abstract", "async"].includes(ts[n]?.value ?? "")) n++;
  const keyword = ts[n];
  if (keyword?.kind !== "word" || !DECLARATION.has(keyword.value)) return null;
  let k = n + 1;
  if (keyword.value === "const" && ts[k]?.value === "enum") k++;
  if (keyword.value === "function" && ts[k]?.value === "*") k++;
  const name = ts[k];
  if (name?.kind !== "word") return null;
  if (keyword.value === "type" && !["=", "<"].includes(ts[k + 1]?.value ?? "")) return null;
  return name.value;
}

/** Names declared at the top level (outside braces, brackets and parentheses), each once per file. */
function topLevelDeclarations(text: string): Set<string> {
  const ts = tokens(text), names = new Set<string>();
  let depth = 0;
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i]!;
    if (t.kind === "punct") { if ("{([".includes(t.value)) depth++; if ("})]".includes(t.value)) depth--; continue; }
    if (depth !== 0 || t.kind !== "word" || !DECLARATION.has(t.value) || ts[i - 1]?.value === "import") continue;
    const name = declaredName(ts, i);
    if (name !== null) names.add(name);
  }
  return names;
}

/** The names a facade exports: its exported declarations and the exported names of its export lists. */
export function publicNames(text: string): Set<string> {
  const ts = tokens(text), names = new Set<string>();
  let depth = 0;
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i]!;
    if (t.kind === "punct") { if ("{([".includes(t.value)) depth++; if ("})]".includes(t.value)) depth--; continue; }
    if (depth !== 0 || t.kind !== "word" || t.value !== "export") continue;
    let n = i + 1;
    if (ts[n]?.value === "type" && ts[n + 1]?.value === "{") n++;
    if (ts[n]?.value !== "{") {
      const name = declaredName(ts, n);
      if (name !== null) names.add(name);
      continue;
    }
    // An export list: `name`, `type name` or `name as exported`, separated by commas.
    let j = n + 1;
    while (j < ts.length && ts[j]!.value !== "}") {
      if (ts[j]!.value === "type" && ts[j + 1]?.kind === "word" && ts[j + 1]!.value !== "as") j++;
      let exported = ts[j];
      if (ts[j + 1]?.value === "as") { exported = ts[j + 2]; j += 2; }
      if (exported?.kind === "word") names.add(exported.value);
      j++;
      if (ts[j]?.value === ",") j++;
    }
  }
  return names;
}

/** Rules (1), (2), (3), (5) and (6). Each failure starts with its rule: "(2) src/contracts/plan-x.ts:3: ...". */
export function familyViolations(tree: Tree): string[] {
  const members = familyMembers(tree), failures: string[] = [];
  const byKey = new Map(members.map(member => [withoutExtension(member.key), member]));
  for (const member of members) {
    const { family, role } = member, ts = tokens(member.text);
    const fail = (rule: number, at: number, what: string): void => { failures.push(`(${rule}) ${member.key}:${lineOf(member.text, at)}: ${what}`); };
    for (const ref of moduleReferences(member.text)) {
      const to = addressed(tree.repo, member.file, ref.specifier);
      const target = to === null ? undefined : byKey.get(to);
      if (target === undefined || target.family !== family || target === member) continue;
      if (target.role === "facade") { if (role !== "facade") fail(1, ref.at, `imports its facade ${target.key}`); continue; }
      if (role === "core") fail(3, ref.at, `the core imports ${target.key}`);
      else if (role === "domain" && target.role !== "core") fail(2, ref.at, `a domain module imports ${target.key}`);
      else if (role === "composition" && target.role !== "core" && (target.role !== "domain" || ref.calculated || !typeOnly(ts, ref.at))) fail(2, ref.at, `the composition layer imports ${target.key} at run time`);
    }
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i]!;
      if (t.kind === "word" && t.value === "export" && (ts[i + 1]?.value === "*" || (ts[i + 1]?.value === "type" && ts[i + 2]?.value === "*"))) fail(5, t.at, "export *");
    }
  }
  for (const family of FAMILIES) {
    const own = members.filter(member => member.family === family), facade = own.find(member => member.role === "facade")!;
    const declaredIn = new Map<string, string[]>();
    for (const member of own) for (const name of topLevelDeclarations(member.text)) declaredIn.set(name, [...(declaredIn.get(name) ?? []), member.key]);
    for (const name of publicNames(facade.text)) {
      const files = declaredIn.get(name) ?? [];
      if (files.length > 1) failures.push(`(6) ${family.name}: ${name} is declared in ${files.join(", ")}`);
    }
  }
  return failures;
}

/** Rule (4) over src and gui/src (with `tree.extra` laid over them): a core, domain or composition member is reached only from its own family. */
export function outsideViolations(tree: Tree, sources?: readonly SourceFile[]): string[] {
  const members = familyMembers(tree), failures: string[] = [];
  const byKey = new Map(members.map(member => [withoutExtension(member.key), member]));
  const texts = new Map<string, string>();
  for (const source of sources ?? [...readSources(path.join(tree.repo, "src")), ...readSources(path.join(tree.repo, "gui", "src"))]) texts.set(relativePath(tree.repo, source.file), source.text);
  for (const [key, text] of tree.extra ?? []) if (key.startsWith("src/") || key.startsWith("gui/src/")) texts.set(key, text);
  for (const [from, text] of texts) {
    const own = byKey.get(withoutExtension(from)), file = path.join(tree.repo, from);
    for (const ref of moduleReferences(text)) {
      const to = addressed(tree.repo, file, ref.specifier);
      const target = to === null ? undefined : byKey.get(to);
      if (target === undefined || target.role === "facade" || own?.family === target.family) continue;
      if (OUTSIDE_ALLOWED.includes(`${from} -> ${target.key}`)) continue;
      failures.push(`(4) ${from}:${lineOf(text, ref.at)}: imports ${target.key}; use ${target.family.dir}/${target.family.facade}`);
    }
  }
  return failures;
}

// Registered tests below; the offline mutation probe copies the exact compiled functions above.
import { test } from "node:test";
const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const REAL: Tree = { repo: REPO };
let realSources: SourceFile[] | undefined;
const sourcesOnce = (): SourceFile[] => (realSources ??= [...readSources(path.join(REPO, "src")), ...readSources(path.join(REPO, "gui", "src"))]);
const all = (extra: ReadonlyMap<string, string>): string[] => [...familyViolations({ repo: REPO, extra }), ...outsideViolations({ repo: REPO, extra }, sourcesOnce())];
const real = (key: string): string => readFileSync(path.join(REPO, key), "utf8");
const plus = (key: string, line: string): [string, string] => [key, `${real(key)}\n${line}\n`];

test("families: each family is found by listing and keeps rules (1) (2) (3) (5) (6)", t => {
  const members = familyMembers(REAL);
  for (const family of FAMILIES) {
    const own = members.filter(m => m.family === family), facade = own.find(m => m.role === "facade")!, exported = publicNames(facade.text).size;
    t.diagnostic(`${family.name}: ${own.map(m => `${path.posix.basename(m.key)}(${m.role})`).join(" ")}; public names ${exported}`);
    assert.ok(own.some(m => m.role !== "facade") && exported > 0, `${family.name} has members besides its facade and public names`);
  }
  assert.deepEqual(familyViolations(REAL), []);
});

test("families: src and gui/src reach a family through its facade only (rule 4)", t => {
  t.diagnostic(`sources read: ${sourcesOnce().length}; known exceptions: ${OUTSIDE_ALLOWED.length}`);
  assert.deepEqual(outsideViolations(REAL, sourcesOnce()), []);
});

test("families: each rule rejects a source that breaks it, and only that rule", () => {
  const cases: readonly (readonly [number, readonly (readonly [string, string])[]])[] = [
    [1, [plus("src/contracts/plan-changes.ts", 'import type { PlanRecorder } from "./plan.js";')]],
    [1, [plus("src/app/input/task-limits.ts", 'const later = () => import("./task.js");')]],
    [1, [plus("src/cli/human/output-history.ts", 'export type { HumanOutput } from "./output.js";')]],
    [1, [["src/contracts/plan-apply.ts", 'import type { PlanRecorder } from "./plan.js";\nexport type Applied = PlanRecorder;\n']]],
    [2, [plus("src/app/input/task-limits.ts", 'import { parseVerifiers } from "./task-verifiers.js";')]],
    [2, [plus("src/contracts/app-files.ts", 'import type { PlanCheck } from "./app-plans.js";')]],
    [2, [["src/contracts/plan-output.ts", 'import { plannedFileStale } from "./plan-changes.js";\nexport const stale = plannedFileStale;\n']]],
    [2, [["src/contracts/plan-output.ts", 'import { type StoredPlannedFile } from "./plan-changes.js";\nexport type Shown = StoredPlannedFile;\n']]],
    [3, [plus("src/cli/human/output-layout.ts", 'import type { createErrorOutput } from "./output-errors.js";')]],
    [4, [plus("src/app/prepare.ts", 'import { fail } from "./input/task-core.js";')]],
    [4, [plus("src/contracts/app-plans.ts", 'import type { MaskedParts } from "./plan-core.js";')]],
    [4, [["gui/src/main/example.ts", 'await import("../../../dist/src/contracts/engine-errors.js");\n']]],
    [5, [plus("src/contracts/plan.ts", 'export * from "./plan-core.js";')]],
    [5, [plus("src/contracts/engine.ts", 'export type * from "./engine-errors.js";')]],
    [6, [plus("src/contracts/app-files.ts", "export interface TaskForm { readonly x: number }")]],
    [6, [plus("src/app/input/task-verifiers.ts", "export function fail(): never { throw new Error(); }")]],
  ];
  for (const [rule, files] of cases) {
    const failures = all(new Map(files));
    assert.ok(failures.length > 0 && failures.every(failure => failure.startsWith(`(${rule})`)), `(${rule}) ${files.map(([key]) => key).join(", ")} -> ${failures.join(" | ")}`);
  }
  const allowed = new Map([["src/contracts/plan-output.ts", 'import type { StoredPlannedFile } from "./plan-changes.js";\nexport type { MaskedPlannedFile } from "./plan-changes.js";\nimport { PLAN_MODES } from "./plan-core.js";\nexport type Shown = StoredPlannedFile | (typeof PLAN_MODES)[number];\n']]);
  assert.deepEqual(all(allowed), [], "the composition layer may read domain modules as types and the core at run time");
});

test("families: comments, strings and regex text are not imports, exports or declarations", () => {
  const member = '// import "./plan.js"; export * from "./plan-core.js";\n/* import { fail } from "./plan-changes.js"; */\nconst quoted = \'import "./plan.js"; export interface PlanRecorder {}\';\nconst pattern = /import\\("\\.\\/plan\\.js"\\)/;';
  const outside = '// import { fail } from "./input/task-core.js";\nconst address = "./input/task-core.js";\nconst pattern = /input\\/task-core\\.js/;';
  assert.deepEqual(all(new Map([plus("src/contracts/plan-changes.ts", member), plus("src/app/prepare.ts", outside)])), []);
});
