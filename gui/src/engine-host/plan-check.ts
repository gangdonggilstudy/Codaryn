/**
 * U-119 (docs/design/standalone-gui.md 3.9, DR-21; adapter-contract 5.14): the app layer's
 * `checkApply` as the window may see it: indexes, codes, counts and the digest only (no path; the
 * plan view's rows are matched by index). It moves and records nothing; it is no consent and no
 * approval. What the check could not take back is passed on: probe links left, probes it removed,
 * and a lock it could not release.
 */

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const CODE = /^[a-z][a-z0-9_]{0,63}$/;
const RUN_ID = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const HOST_ERROR = { ok: false, code: "host_error" } as const;
/** No plan has more actions than this (the window's plan view takes at most as many). */
export const MAX_PLAN_CHECK_ITEMS = 100_000;

export function planCheckValue(outcome: unknown): Obj {
  if (!isObj(outcome)) return HOST_ERROR;
  if (outcome["ok"] !== true) {
    const code = isObj(outcome["error"]) ? outcome["error"]["code"] : undefined;
    return { ok: false, code: typeof code === "string" && CODE.test(code) ? code : "host_error" };
  }
  const output = outcome["output"];
  if (!isObj(output) || output["kind"] !== "plan_check") return HOST_ERROR;
  const { planRunId, digest, problems, unsafeMoves, inventoryLimitReached, probesLeft, probesRemoved, lockLeft } = output;
  if (typeof planRunId !== "string" || !RUN_ID.test(planRunId) || typeof digest !== "string" || !DIGEST.test(digest)) return HOST_ERROR;
  if (!Array.isArray(problems) || problems.length > MAX_PLAN_CHECK_ITEMS || !Array.isArray(unsafeMoves) || unsafeMoves.length > MAX_PLAN_CHECK_ITEMS) return HOST_ERROR;
  if (typeof inventoryLimitReached !== "boolean" || !count(probesLeft) || !count(probesRemoved) || typeof lockLeft !== "boolean") return HOST_ERROR;
  const found: { index: number; problem: string }[] = [];
  for (const item of problems) {
    if (!isObj(item) || !count(item["index"]) || typeof item["problem"] !== "string" || !CODE.test(item["problem"])) return HOST_ERROR;
    found.push({ index: item["index"], problem: item["problem"] });
  }
  if (!unsafeMoves.every(count)) return HOST_ERROR;
  return { ok: true, planRunId, digest, problems: found, unsafeMoves: [...unsafeMoves], inventoryLimitReached, probesLeft, probesRemoved, lockLeft };
}
