/**
 * N-19: one JSON line in ASCII only. Every character above U+007F is written as \uXXXX (an
 * astral character as its surrogate pair), which JSON reads back as the same value. A console
 * that decodes stdout with a legacy code page (Windows PowerShell 5.1) cannot garble it.
 */
export function jsonLine(value: unknown): string {
  const text = JSON.stringify(value).replace(/[\u0080-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return `${text}\n`;
}
