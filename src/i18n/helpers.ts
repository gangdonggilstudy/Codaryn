/** Small helpers the catalogs share. */

/** The entry for a code, or the fallback for a code the table does not have (such as "?"). */
export function pick(table: Readonly<Record<string, string>>, code: string, fallback: string): string {
  return Object.hasOwn(table, code) ? (table[code] as string) : fallback;
}

/** English noun for a rendered count: singular for "1", plural otherwise (including "?"). */
export function plural(count: string, one: string, many: string): string {
  return `${count} ${count === "1" ? one : many}`;
}
