/** Renderer response primitives and workspace identity. Shared imports are types only. */
import type { RunFormView } from "../shared/ipc.js";

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): value is string => typeof value === "string";
const HEX = /^[0-9a-f]{32}$/;

export interface Workspace {
  readonly handle: string;
  readonly name: string;
  /** R21b-L-1: the form of the last run started here from this app, or null. */
  readonly lastForm?: RunFormView | null;
}

/** A remembered task form, or null when it does not fit. */
export function asForm(value: unknown): RunFormView | null {
  if (!isObj(value)) return null;
  const name = (v: unknown): v is string | null => v === null || (str(v) && v.length > 0 && v.length <= 200);
  return name(value["profile"]) && name(value["workflow"]) ? { profile: value["profile"], workflow: value["workflow"] } : null;
}

export function asWorkspace(value: unknown): Workspace | null {
  if (!isObj(value) || !str(value["handle"]) || !HEX.test(value["handle"]) || !str(value["name"])) return null;
  return { handle: value["handle"], name: value["name"], lastForm: asForm(value["lastForm"]) };
}

const failed = (value: unknown): { readonly ok: false; readonly code: string } => ({ ok: false, code: isObj(value) && str(value["code"]) ? value["code"] : "host_error" });
const strList = (value: unknown): value is string[] => Array.isArray(value) && value.every(str);

const RUN_ID = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/;

export { isObj, str, HEX, failed, strList, RUN_ID };
