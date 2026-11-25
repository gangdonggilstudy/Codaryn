/** Shared IPC leaf checks: no runtime dependencies. Public callers use ../ipc.js. */

/** A workspace handle the main process issued: 128 random bits as lowercase hex. */
export const HANDLE_PATTERN = /^[0-9a-f]{32}$/;

export function isHandle(value: unknown): value is string {
  return typeof value === "string" && HANDLE_PATTERN.test(value);
}

export type Obj = Record<string, unknown>;

export function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasOnlyKeys(value: Obj, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

const MAX_TEXT = 1000;
export const MAX_ITEMS = 500;
export const shortText = (value: unknown): value is string => typeof value === "string" && value.length <= MAX_TEXT;
export const textList = (value: unknown): value is string[] => Array.isArray(value) && value.length <= MAX_ITEMS && value.every(shortText);
export const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const RUN_ID = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/;

export function isRunId(value: unknown): value is string {
  return typeof value === "string" && RUN_ID.test(value);
}
