/**
 * Contract app*.ts boundaries (IR-26 step 3, A0-A3): the app contract is types only, split into
 * app-core and domain modules under the app.ts facade. No compiler API or runtime loading.
 * (a) Every import and export-from is type-only, with no `export *`. (b) No module imports app.js;
 * app-core imports no other app-* module, and a domain module none but app-core. (c) The modules hold
 * types only: type imports, explicit `export type`, interfaces and type aliases. (d) Each public name
 * is declared once across them. (e) src and gui/src reach them only through contracts/app.js.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The tokenizer, module references and source reading below are copied unchanged from
// gui/tests/unit/ipc-guards.test.ts: the root and GUI test projects share no test code.
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

/** src/contracts/app.ts and app-<name>.ts, found by listing so that a new domain module is covered too. */
const APP_FILE = /^app(?:-[a-z][a-z0-9-]*)?\.ts$/;
export function readAppContracts(dir: string): SourceFile[] {
  return readdirSync(dir, { withFileTypes: true }).filter(entry => APP_FILE.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name)).map(entry => {
    assert.ok(entry.isFile() && !entry.isSymbolicLink(), `app contract module needs review: ${entry.name}`);
    return { file: path.join(dir, entry.name), text: readFileSync(path.join(dir, entry.name), "utf8") };
  });
}

const lineOf = (text: string, at: number): number => text.slice(0, at).split("\n").length;
const moduleName = (file: string): string => path.basename(file).replace(/\.[^.]+$/, "");
/** Words that start a runtime statement. Outside braces, brackets and parentheses a type-only module has none. */
const VALUE_WORDS = new Set(["const", "let", "var", "function", "class", "enum", "namespace", "module", "declare", "default", "async"]);

/** Rules (a) to (d) over the app contract modules. Each failure starts with its rule: "(a) app.ts:3: ...". */
export function appContractViolations(dir: string, sources: readonly SourceFile[] = readAppContracts(dir)): string[] {
  const failures: string[] = [], declared = new Map<string, string>();
  for (const source of sources) {
    const name = path.basename(source.file), from = moduleName(source.file), ts = tokens(source.text);
    const fail = (rule: string, at: number, what: string): void => { failures.push(`(${rule}) ${name}:${lineOf(source.text, at)}: ${what}`); };
    let depth = 0;
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i]!, next = ts[i + 1], after = ts[i + 2];
      if (t.kind === "punct") { if ("{([".includes(t.value)) depth++; if ("})]".includes(t.value)) depth--; continue; }
      if (t.kind !== "word") continue;
      if (t.value === "require" && next?.value === "(") { fail("a", t.at, "require"); continue; }
      if (t.value === "import") {
        // Only a statement-level `type` erases the import: `import { type X }` keeps `import {} from` under verbatimModuleSyntax.
        if (next?.value === "(") fail("a", t.at, "dynamic import");
        else if (next?.value === ".") fail("c", t.at, "import.meta");
        else if (next?.value !== "type" || after === undefined || !(after.value === "{" || after.value === "*" || (after.kind === "word" && after.value !== "from"))) fail("a", t.at, "import without a statement-level type");
        continue;
      }
      if (depth !== 0) continue;
      if (t.value === "export") {
        if (next?.value === "*") fail("a", t.at, "export *");
        else if (next?.value === "type" && after?.value === "*") fail("a", t.at, "export type *");
        else if (next?.value === "type" && after?.value === "{") continue;
        else if ((next?.value === "type" || next?.value === "interface") && after?.kind === "word") {
          const seen = declared.get(after.value);
          if (seen === undefined) declared.set(after.value, `${name}:${lineOf(source.text, t.at)}`);
          else fail("d", t.at, `${after.value} is also declared at ${seen}`);
        } else if (next?.value === "{") {
          let j = i + 1;
          while (j < ts.length && ts[j]!.value !== ";" && ts[j]!.value !== "from") j++;
          fail(ts[j]?.value === "from" ? "a" : "c", t.at, "export list without a statement-level type");
        } else fail("c", t.at, `export ${next?.value ?? ""}`);
        continue;
      }
      if (VALUE_WORDS.has(t.value)) fail("c", t.at, t.value);
    }
    for (const ref of moduleReferences(source.text)) {
      const spec = ref.specifier.replace(/\\/g, "/");
      const target = spec.startsWith(".") ? path.resolve(path.dirname(source.file), spec) : null;
      const to = target !== null && path.dirname(target) === path.dirname(source.file) ? moduleName(target) : null;
      if (ref.calculated) fail("b", ref.at, `calculated address ${spec}`);
      else if (to === "app") fail("b", ref.at, "imports the facade app.js");
      else if (to !== null && to.startsWith("app-") && from !== "app" && (from === "app-core" || to !== "app-core")) fail("b", ref.at, `${from} imports ${to}`);
    }
  }
  return failures;
}

/** Rule (e): outside the app contract modules, src and gui/src import contracts/app.js only, never app-<name>.js. */
export function facadeEntryViolations(repo: string, sources?: readonly SourceFile[]): string[] {
  const contracts = path.join(repo, "src", "contracts"), failures: string[] = [];
  const list = sources ?? [...readSources(path.join(repo, "src")), ...readSources(path.join(repo, "gui", "src"))];
  for (const source of list) {
    if (path.dirname(source.file) === contracts && APP_FILE.test(path.basename(source.file))) continue;
    for (const ref of moduleReferences(source.text)) {
      const spec = ref.specifier.replace(/\\/g, "/");
      const target = spec.startsWith(".") ? path.resolve(path.dirname(source.file), spec) : null;
      const domain = target !== null && path.dirname(target) === contracts && moduleName(target).startsWith("app-");
      if (domain || /(?:^|\/)contracts\/app-[^/]*$/.test(spec)) failures.push(`(e) ${path.relative(repo, source.file).replace(/\\/g, "/")}:${lineOf(source.text, ref.at)}: use contracts/app.js: ${spec}`);
    }
  }
  return failures;
}

// Registered tests below; the offline mutation probe copies the exact compiled functions above.
import { test } from "node:test";
const REPO = fileURLToPath(new URL("../../../../", import.meta.url)), CONTRACTS = path.join(REPO, "src", "contracts");

test("app contracts: the facade and its modules hold types only, import in one direction and declare each name once", t => {
  const files = readAppContracts(CONTRACTS).map(source => path.basename(source.file));
  assert.ok(files.includes("app.ts") && files.includes("app-core.ts"), files.join(", "));
  t.diagnostic(`app contract modules: ${files.join(", ")}`);
  assert.deepEqual(appContractViolations(CONTRACTS), []);
});

test("app contracts: src and gui/src reach the domain modules only through contracts/app.js", t => {
  const sources = [...readSources(path.join(REPO, "src")), ...readSources(path.join(REPO, "gui", "src"))];
  t.diagnostic(`sources read: ${sources.length}`);
  assert.deepEqual(facadeEntryViolations(REPO, sources), []);
});

test("app contracts: each rule rejects a source that breaks it, and only that rule", () => {
  const at = (name: string, text: string): SourceFile => ({ file: path.join(CONTRACTS, name), text });
  const broken: readonly (readonly [string, readonly SourceFile[]])[] = [
    ["a", [at("app-files.ts", 'import { TaskForm } from "./app-core.js";')]],
    ["a", [at("app-files.ts", 'import { type TaskForm } from "./app-core.js";')]],
    ["a", [at("app-files.ts", 'import "./text.js";')]],
    ["a", [at("app.ts", 'export * from "./app-core.js";')]],
    ["a", [at("app.ts", 'export type * from "./app-core.js";')]],
    ["a", [at("app.ts", 'export { TaskForm } from "./app-core.js";')]],
    ["a", [at("app-plans.ts", 'export type Lazy = typeof import("./text.js");')]],
    ["b", [at("app-files.ts", 'import type { CodarynApp } from "./app.js";')]],
    ["b", [at("app-core.ts", 'import type { WorkspaceText } from "./app-files.js";')]],
    ["b", [at("app-plans.ts", 'import type { SettingsView } from "./app-settings.js";')]],
    ["c", [at("app.ts", "export const APP_VERSION = 1;")]],
    ["c", [at("app-core.ts", "const helper = 1;")]],
    ["c", [at("app-settings.ts", "export function settingsOf(): void {}")]],
    ["c", [at("app.ts", "export default interface Fallback {}")]],
    ["d", [at("app-files.ts", "export interface Shared { readonly a: string }"), at("app-plans.ts", "export type Shared = string;")]],
  ];
  for (const [rule, sources] of broken) {
    const failures = appContractViolations(CONTRACTS, sources);
    assert.ok(failures.length > 0 && failures.every(failure => failure.startsWith(`(${rule})`)), `${rule}: ${sources.map(s => s.text).join(" / ")} -> ${failures.join(" | ")}`);
  }
  for (const sources of [
    [at("app-files.ts", 'import type { TaskForm } from "./app-core.js";\nexport interface View { readonly form: TaskForm }')],
    [at("app.ts", 'import type { View } from "./app-files.js";\nexport type { View } from "./app-files.js";\nexport type { View as Shown };\nexport interface CodarynApp { view(): View }')],
    [at("app-core.ts", 'import type { MaskedText } from "./text.js";\nexport type Note<T> = { readonly text: MaskedText; readonly value: T };')],
  ]) assert.deepEqual(appContractViolations(CONTRACTS, sources), [], sources[0]!.text);
  const user = (file: string, text: string): SourceFile => ({ file: path.join(REPO, ...file.split("/")), text });
  for (const [source, rejected] of [
    [user("src/app/example.ts", 'import type { WorkspaceText } from "../contracts/app-files.js";'), true],
    [user("src/contracts/index.ts", 'export type { TaskForm } from "./app-core.js";'), true],
    [user("gui/src/main/example.ts", 'await import("../../../src/contracts/app-core.js");'), true],
    [user("gui/src/main/example.ts", 'import type { RunFacts } from "../../../dist/src/contracts/app-core.js";'), true],
    [user("src/app/example.ts", 'import type { CodarynApp } from "../contracts/app.js";'), false],
    [user("src/contracts/app-plans.ts", 'import type { TaskForm } from "./app-core.js";'), false],
  ] as const) assert.equal(facadeEntryViolations(REPO, [source]).length > 0, rejected, source.text);
});

test("app contracts: comments, strings, regex text and member names are not imports or values", () => {
  const text = [
    '// import { TaskForm } from "./app.js"; export const x = 1;',
    '/* export * from "./app-files.js"; const helper = 1; require("./app-core.js") */',
    "export type Note = 'import \"./app.js\"; export const x = 1;' | `export * from \"./app-files.js\"`;",
    "export interface Shape { readonly class: string; readonly default: number; readonly function: () => void }",
  ].join("\n");
  assert.deepEqual(appContractViolations(CONTRACTS, [{ file: path.join(CONTRACTS, "app-files.ts"), text }]), []);
  const user = '// import type { X } from "../contracts/app-core.js";\nconst label = "../contracts/app-files.js";\nconst pattern = /contracts\\/app-plans\\.js/;';
  assert.deepEqual(facadeEntryViolations(REPO, [{ file: path.join(REPO, "src", "app", "example.ts"), text: user }]), []);
});
