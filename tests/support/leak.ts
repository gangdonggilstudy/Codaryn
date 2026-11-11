/**
 * Canary leak scanning. Checks the raw value and the listed variants only
 * (Base64, URL encoding, JSON escape, hex). Passing says nothing about other transformations.
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

export function secretVariants(secret: string): Variant[] {
  const bytes = Buffer.from(secret, "utf8");
  const json = JSON.stringify(secret).slice(1, -1);
  const candidates: Variant[] = [
    { name: "raw", value: secret },
    { name: "base64", value: bytes.toString("base64") },
    { name: "url", value: encodeURIComponent(secret) },
    { name: "json", value: json },
    // Tool payloads are JSON text stored inside JSON lines, so a leak may be escaped twice.
    { name: "json-in-json", value: JSON.stringify(json).slice(1, -1) },
    { name: "hex", value: bytes.toString("hex") },
    { name: "HEX", value: bytes.toString("hex").toUpperCase() },
  ];
  const seen = new Set<string>();
  return candidates.filter((variant) => {
    if (seen.has(variant.value)) return false;
    seen.add(variant.value);
    return true;
  });
}

/** Returns one line per leak found; an empty list means no listed variant was present. */
export function findLeaks(sources: readonly TextSource[], secrets: readonly string[]): string[] {
  const leaks: string[] = [];
  for (const secret of secrets) {
    for (const variant of secretVariants(secret)) {
      for (const source of sources) {
        if (source.text.includes(variant.value)) leaks.push(`${variant.name} variant found in ${source.label}`);
      }
    }
  }
  return leaks;
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
