/** Per-run call identities and permission questions, each with its own private state. */
import { ALL_TOOL_NAMES, REPLACED_CALL_ID_PREFIX, UNKNOWN_TOOL_RECORD_NAME } from "../contracts/index.js";
import type { ConfirmAnswer, ConfirmRequest, ConfirmationBy, ConfirmationDecision, EffectiveToolCall, EngineDeps, PolicyDecision, ToolCall, ToolDescriptor, ToolName } from "../contracts/index.js";
import { CALL_ID_PATTERN, MASKING_FAILED, answerDecision } from "./pure.js";
import type { End } from "./pure.js";
import type { createRunHelpers } from "./run-helpers.js";

export function createCallIds(mask: ReturnType<typeof createRunHelpers>["mask"]) {
  /** AC-D15: the recorded id of every model-given call id seen in this run, and the ids in use. */
  const recordedIds = new Map<string, string>();
  const usedIds = new Set<string>();
  let replacedIds = 0;

  /**
   * AC-D15 (DR-13, R-1 L-1): the calls of one model response as the engine records, answers and
   * sends them back. A name in no tool list becomes UNKNOWN_TOOL_RECORD_NAME (so it is unknown_tool).
   * An id is kept when it passes CALL_ID_PATTERN_SOURCE, masking leaves it unchanged and no other id
   * stands for it; otherwise it gets REPLACED_CALL_ID_PREFIX and a number not in use. The same id
   * keeps its recorded id for the whole run, so a call and its result stay paired and a repeated
   * call is still answered once. Ids that can be kept are placed first, so a replacement never
   * takes the place of a valid id given in the same response.
   */
  const recordableCalls = (given: readonly ToolCall[]): ToolCall[] => {
    const keepable = (id: string): boolean => {
      if (!CALL_ID_PATTERN.test(id) || usedIds.has(id)) return false;
      return mask(id) === id;
    };
    for (const call of given) {
      if (recordedIds.has(call.id) || !keepable(call.id)) continue;
      recordedIds.set(call.id, call.id);
      usedIds.add(call.id);
    }
    return given.map((call) => {
      let id = recordedIds.get(call.id);
      if (id === undefined) {
        do {
          replacedIds += 1;
          id = `${REPLACED_CALL_ID_PREFIX}${replacedIds}`;
        } while (usedIds.has(id));
        recordedIds.set(call.id, id);
        usedIds.add(id);
      }
      const name = (ALL_TOOL_NAMES as readonly string[]).includes(call.name) ? call.name : UNKNOWN_TOOL_RECORD_NAME;
      return { id, name, args: call.args };
    });
  };

  return { recordableCalls };
}

export function createPermission(
  shownText: ReturnType<typeof createRunHelpers>["shownText"],
  record: ReturnType<typeof createRunHelpers>["record"],
  interrupted: ReturnType<typeof createRunHelpers>["interrupted"],
  recordDenial: ReturnType<typeof createRunHelpers>["recordDenial"],
  policy: EngineDeps["policy"],
  deps: Pick<EngineDeps, "confirm">,
  runSignal: AbortSignal,
) {
  /** U-74: the number of the last permission question of this run (ConfirmRequest.id `q<k>`). */
  let confirmations = 0;

  /**
   * U-74 B-3 (DR-3, DR-10): the second check gave the confirm mark. Records the question (fixed
   * fields, the masked executable, the number of arguments; never the arguments), asks
   * EngineDeps.confirm (absent: nobody, so deny by default), records the answer, and after
   * `allow_once` judges the same call again: allowed, or the same mark (the answer is for this call
   * once), runs it; any other denial denies. The wait counts in maxDurationMs: the run's signal ends
   * it, and a cancel or the time limit then ends the run. U-137 (R88b-L1): then too the call's
   * denial is recorded after the answer, with no result (the run ends).
   */
  const askPermission = async (
    call: ToolCall,
    tool: ToolName,
    effective: EffectiveToolCall,
    descriptor: ToolDescriptor,
    mark: Extract<PolicyDecision, { allowed: false }>,
  ): Promise<PolicyDecision | End> => {
    const args = effective.args as { readonly executable?: unknown; readonly args?: unknown };
    // U-106 (R-79 L-2): a screen shows the subject as it is, so it is made safe as the final message
    // is (safeModelText): masked by the gateway and its key shapes hidden. Null fails closed.
    const subject = shownText(typeof args.executable === "string" ? args.executable : "");
    if (subject === null) return MASKING_FAILED;
    confirmations += 1;
    const request: ConfirmRequest = {
      kind: "permission",
      id: `q${confirmations}`,
      callId: call.id,
      tool,
      permission: mark.permission,
      subject,
      argumentCount: Array.isArray(args.args) ? args.args.length : 0,
    };
    await record({ type: "confirmation_requested", ...request });
    // U-120 (R-86 L-1): the asker gets a frozen copy, and the answer record takes the id from the
    // engine's own question, so a changed copy changes no record.
    const { id } = request;
    const asked: ConfirmRequest = Object.freeze({ ...request });
    let decision: ConfirmAnswer["decision"] = "dismissed";
    const ask = deps.confirm;
    if (ask !== undefined && !runSignal.aborted) {
      let stopWaiting: () => void = () => {};
      const ended = new Promise<never>((_resolve, reject) => {
        stopWaiting = () => reject(new Error("the run's signal aborted"));
        runSignal.addEventListener("abort", stopWaiting, { once: true });
      });
      try {
        // U-106 (R-79 L-3): the answer is read once, right after it came (answerDecision).
        decision = answerDecision(await Promise.race([ask(asked, runSignal), ended]));
      } catch {
        decision = "dismissed";
      } finally {
        runSignal.removeEventListener("abort", stopWaiting);
        ended.catch(() => {});
      }
    }
    const answered = async (decision: ConfirmationDecision, by: ConfirmationBy): Promise<void> => {
      await record({ type: "confirmation_answered", id, decision, by });
    };
    const stop = interrupted();
    if (stop !== null) {
      await answered("deny", stop.status === "cancelled" ? "cancelled" : "default");
      // U-137 (R88b-L1): the call is denied as when the answer is no, so its decision follows the
      // answer (journal.ts) and every reader counts it among the denied calls. No result goes back
      // to the model: the run ends here.
      await recordDenial(call, "policy_effective", mark);
      return stop;
    }
    if (decision !== "allow_once") {
      await answered("deny", decision === "deny" ? "user" : "default");
      return mark;
    }
    await answered("allow_once", "user");
    const again = await policy.checkEffective(effective, descriptor);
    return again.allowed || again.confirm === true ? { allowed: true } : again;
  };

  return { askPermission };
}
