import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ApiProviderName } from "../contracts/index.js";

export const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
export const BOM = String.fromCharCode(0xfeff);

/** Options for writing the config file. */
export interface ConfigWriteOptions {
  /** True: the file must not exist yet (it is created). False: it is replaced. */
  readonly exclusive: boolean;
  /** The text read before; the write is refused when the file holds something else now. */
  readonly expected: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The leading spaces or tabs of the first indented line, or two spaces. */
function detectIndent(text: string): string {
  for (const line of text.split(LF).slice(1)) {
    let end = 0;
    while (end < line.length && (line[end] === " " || line[end] === "\t")) end += 1;
    if (end > 0 && end < line.length && line[end] !== CR) return line.slice(0, Math.min(end, 10));
  }
  return "  ";
}

/**
 * The config text with `model` set to `id` (Y-3). What is kept: every field and value, the order
 * of the fields (`model` stays where it was, or follows `schemaVersion`), a byte order mark, the
 * line ending (CRLF or LF), the indentation of the first indented line, and a final line feed.
 * What is written anew: the layout of whitespace, number spelling (`1e3` becomes `1000`), string
 * escapes, and duplicate fields (the last value stays).
 */
export function withModel(text: string, id: string, place: ApiProviderName | null = null): string {
  const bom = text.startsWith(BOM) ? BOM : "";
  const body = bom === "" ? text : text.slice(1);
  const eol = body.includes(`${CR}${LF}`) ? `${CR}${LF}` : LF;
  const value = JSON.parse(body) as Record<string, unknown>;
  let next: Record<string, unknown>;
  if (place !== null) {
    // SP-6: providers.<place>.model; the entry and `providers` keep their fields and order, and are
    // added at the end when missing.
    const providers = isRecord(value["providers"]) ? value["providers"] : {};
    const entry = isRecord(providers[place]) ? providers[place] : {};
    next = { ...value, providers: { ...providers, [place]: { ...entry, model: id } } };
  } else if (Object.hasOwn(value, "model")) {
    next = { ...value, model: id };
  } else {
    next = {};
    for (const [key, item] of Object.entries(value)) {
      next[key] = item;
      if (key === "schemaVersion") next["model"] = id;
    }
    if (!Object.hasOwn(next, "model")) next["model"] = id;
  }
  const printed = JSON.stringify(next, null, detectIndent(body)).split(LF).join(eol);
  return `${bom}${printed}${body.endsWith(LF) ? eol : ""}`;
}

/**
 * The default writer: replaces the file through a temporary file in the same directory and a
 * rename, after checking that the file still holds `expected`. A link is followed: the file it
 * points at is replaced, the link stays. On any failure the temporary file is removed and the
 * target is left as it was. `exclusive` creates the file and fails if it exists.
 */
export async function writeConfigAtomic(file: string, text: string, options: ConfigWriteOptions): Promise<void> {
  if (options.exclusive) {
    await fs.writeFile(file, text, { encoding: "utf8", flag: "wx" });
    return;
  }
  const target = await fs.realpath(file);
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomBytes(6).toString("hex")}.tmp`);
  await fs.writeFile(temporary, text, { encoding: "utf8", flag: "wx" });
  try {
    const { mode } = await fs.stat(target);
    await fs.chmod(temporary, mode & 0o777);
    const current = await fs.readFile(target, "utf8");
    if (current !== options.expected) throw new Error("the config file changed while models ran");
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}
