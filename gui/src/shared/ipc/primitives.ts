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

const ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;

/** The code of an engine host value that is not ok, or "host_error". */
export function hostCodeOf(value: unknown): string {
  const code = isObj(value) ? value["code"] : undefined;
  return typeof code === "string" && ERROR_CODE.test(code) ? code : "host_error";
}

const HINT_ID = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * U-212 (bundle A): a start the engine host refused: its code, and the CLI's hint id when the app layer
 * gave one (error.hint.<hint>, e.g. unreadable_paths_required for analyze-private without an unreadable
 * path). An id only; the window shows a hint it has words for.
 */
export function toStartFailure(value: unknown): { readonly ok: false; readonly code: string; readonly hint?: string } {
  const hint = isObj(value) ? value["hint"] : undefined;
  return { ok: false, code: hostCodeOf(value), ...(typeof hint === "string" && HINT_ID.test(hint) ? { hint } : {}) };
}

const DIGEST = /^[0-9a-f]{64}$/;

const WORD = /^[a-z][a-z_-]{0,39}$/;

const NAME = /^[^\u0000-\u001f\u007f]{1,200}$/;

/** Control and direction characters other than LF and TAB (the engine host replaced them). */
const UNSAFE_IN_MESSAGE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

const numOrNull = (value: unknown): value is number | null => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);

const nameOrNull = (value: unknown): value is string | null => value === null || (typeof value === "string" && NAME.test(value));

// Internal shared checks; only original public names are re-exported by the facade.
export { ERROR_CODE, DIGEST, WORD, NAME, UNSAFE_IN_MESSAGE, numOrNull, nameOrNull };
