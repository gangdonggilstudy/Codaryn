/**
 * U-189 (T-1 of the tool path race study, report-tool-path-race.md): the real path the policy gate
 * judged for a tool argument, so the tool can tell when its own resolution of that argument lands
 * elsewhere.
 *
 * - The gate (`checkEffective`) resolves each path argument and judges the real path it gets
 *   (protected paths, writable lists, the state directory). The tool resolves the same argument
 *   again before it uses it. A folder swapped for a link or junction in between (by a background
 *   process a command left, or another program) makes the tool's real path another one, possibly a
 *   protected path or one outside the writable lists. The gate notes what it judged; the tool takes
 *   the note when it resolves the same argument and refuses when the two real paths differ.
 * - A note is taken once: each gate judgment pairs with the next tool resolution of that argument.
 *   An argument the gate did not judge (a test without a gate, the entries `search_files` resolves
 *   one by one) has no note, and the tool goes on as before.
 * - Kept per workspace object (the CLI and the app give the gate and the tools the same one), in
 *   memory only, keyed by the argument as given and its access. No contract type changes.
 * - What it does not close: a swap after the tool's own resolution. Reads check that themselves
 *   (guarded.ts); writes, listings and the plan executor do not yet (the study's W-3 to W-5, P-3 to
 *   P-7).
 */

import type { PathAccess, ResolvedPath, Workspace } from "../contracts/index.js";

const notes = new WeakMap<Workspace, Map<string, string>>();
/** At most this many notes per workspace (a run judges a handful at a time); the oldest go first. */
const MAX_NOTES = 256;

const keyOf = (input: string, access: PathAccess): string => `${access}\u0000${input}`;

/** The gate judged `resolved` for the argument `input` with `access`. */
export function noteJudged(workspace: Workspace, input: string, access: PathAccess, resolved: ResolvedPath): void {
  let map = notes.get(workspace);
  if (map === undefined) {
    map = new Map();
    notes.set(workspace, map);
  }
  const key = keyOf(input, access);
  map.delete(key);
  map.set(key, resolved.absolute);
  while (map.size > MAX_NOTES) map.delete(map.keys().next().value as string);
}

/** The real path the gate judged for this argument, taken (at most once), or undefined when it judged none. */
export function takeJudged(workspace: Workspace, input: string, access: PathAccess): string | undefined {
  const map = notes.get(workspace);
  if (map === undefined) return undefined;
  const key = keyOf(input, access);
  const judged = map.get(key);
  map.delete(key);
  return judged;
}
