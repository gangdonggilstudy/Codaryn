/**
 * Canary leak scanning. Checks the raw value and the listed variants only
 * (Base64, URL encoding, JSON escape, hex), plus extended variants when asked.
 * Passing says nothing about other transformations.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface Variant {
  readonly name: string;
  readonly value: string;
}

export interface TextSource {
  readonly label: string;
  readonly text: string;
}

export interface VariantOptions {
  /** Also unpadded Base64, base64url and lowercase percent encoding. */
  readonly extended?: boolean;
}

function jsonEscape(text: string): string {
  return JSON.stringify(text).slice(1, -1);
}

export function secretVariants(secret: string, options: VariantOptions = {}): Variant[] {
  const bytes = Buffer.from(secret, "utf8");
  const json1 = jsonEscape(secret);
  // Tool payloads are JSON text stored inside JSON lines, and a command may itself print JSON,
  // so a leak can be escaped up to three times in a journal file.
  const json2 = jsonEscape(json1);
  const json3 = jsonEscape(json2);
  const candidates: Variant[] = [
    { name: "raw", value: secret },
    { name: "base64", value: bytes.toString("base64") },
    { name: "url", value: encodeURIComponent(secret) },
    { name: "json", value: json1 },
    { name: "json-in-json", value: json2 },
    { name: "json-x3", value: json3 },
    { name: "hex", value: bytes.toString("hex") },
    { name: "HEX", value: bytes.toString("hex").toUpperCase() },
  ];
  if (options.extended === true) {
    candidates.push(
      { name: "base64-nopad", value: bytes.toString("base64").replace(/=+$/, "") },
      { name: "base64url", value: bytes.toString("base64url") },
      {
        name: "url-lowercase",
        value: encodeURIComponent(secret).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()),
      },
    );
  }
  const seen = new Set<string>();
  return candidates.filter((variant) => {
    if (seen.has(variant.value)) return false;
    seen.add(variant.value);
    return true;
  });
}

/** Returns one line per leak found; an empty list means no checked variant was present. */
export function findLeaks(
  sources: readonly TextSource[],
  secrets: readonly string[],
  options: VariantOptions = {},
): string[] {
  const leaks: string[] = [];
  for (const secret of secrets) {
    for (const variant of secretVariants(secret, options)) {
      for (const source of sources) {
        if (source.text.includes(variant.value)) leaks.push(`${variant.name} variant found in ${source.label}`);
      }
    }
  }
  return leaks;
}

/**
 * Finds any piece of `secret` that is `minLength` characters long. A cut-off secret leaves such
 * a piece even when the full value is gone. Choose secrets whose pieces cannot occur by chance.
 */
export function findFragments(sources: readonly TextSource[], secret: string, minLength: number): string[] {
  const found: string[] = [];
  for (let start = 0; start + minLength <= secret.length; start += 1) {
    const piece = secret.slice(start, start + minLength);
    for (const source of sources) {
      if (source.text.includes(piece)) found.push(`piece at ${start} ("${piece}") found in ${source.label}`);
    }
  }
  return found;
}

function collectStrings(value: unknown, out: string[], depth: number): void {
  if (typeof value === "string") {
    out.push(value);
    const trimmed = value.trim();
    if (depth < 4 && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
      try {
        collectStrings(JSON.parse(trimmed), out, depth + 1);
      } catch {
        // not JSON text
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, depth);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out.push(key);
      collectStrings(child, out, depth);
    }
  }
}

/**
 * Decodes JSON (or JSON lines) and every string field that is itself JSON text, then returns
 * all decoded strings as one source. This finds leaks regardless of how often they were escaped.
 */
export function decodedSource(label: string, text: string, jsonLines: boolean): TextSource {
  const strings: string[] = [];
  const documents = jsonLines ? text.split("\n").filter((line) => line.trim() !== "") : [text];
  for (const document of documents) {
    try {
      collectStrings(JSON.parse(document), strings, 0);
    } catch {
      strings.push(document);
    }
  }
  return { label: `${label} (decoded)`, text: strings.join("\u0000") };
}

/** Every file under `dir`, decoded as UTF-8, labelled by its path relative to `labelRoot`. */
export function readTreeTexts(dir: string, labelRoot: string): TextSource[] {
  const sources: TextSource[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile()) sources.push({ label: relative(labelRoot, full), text: readFileSync(full, "utf8") });
    }
  };
  walk(dir);
  return sources;
}
