/**
 * DR-38 (PM after bf04750): a result names what the state checks found only when they found
 * something. The engine gives `stateChanged` whenever it recorded a state check, so a run or an apply
 * whose records did not change would print and store `"stateChanged":[]`, which an output of before
 * DR-38 does not have. The CLI leaves an empty list out where it takes a result from the engine and
 * where it reads one back, so such a run's output and result.json stay byte for byte as before (the
 * other keys keep their order). A non-empty list is kept as it is.
 */

/** `result` without `stateChanged` when that list is empty; `result` itself otherwise. */
export function withoutEmptyStateChanged<T extends object>(result: T): T {
  const list = (result as { readonly stateChanged?: unknown }).stateChanged;
  if (!Array.isArray(list) || list.length > 0) return result;
  const copy = { ...result } as { [key: string]: unknown };
  delete copy["stateChanged"];
  return copy as T;
}
