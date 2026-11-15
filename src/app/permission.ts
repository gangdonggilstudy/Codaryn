/**
 * U-108 (B-4, DR-3, adapter-contract 5.9): the engine's permission question (EngineDeps.confirm,
 * U-74) relayed to the adapter (RunObserver.confirm).
 *
 * - The request is the contract's ConfirmRequest as the engine made it (fixed fields, the masked
 *   executable made safe for a screen, U-106; never the arguments). The run's signal is passed on:
 *   it aborts when the run is cancelled or its time is up, and the engine stops waiting then.
 * - Anything but a decision is `dismissed`, which the engine records as deny by `default`, never as
 *   the person's (DR-10): no observer or no `confirm`, a `confirm` that throws (at once or later),
 *   an answer that is not an object, or whose `decision` is not an own data property holding one of
 *   CONFIRM_ANSWER_DECISIONS. The decision is read once and a getter is never called, so the
 *   adapter's object cannot answer one thing here and another later; the engine gets a fresh object.
 * - The question's two journal records reach the observer as run events by the journal wrapper
 *   (events.ts): `confirmation_requested` before `confirm` is called, then `confirmation_answered`.
 */

import { CONFIRM_ANSWER_DECISIONS } from "../contracts/index.js";
import type { ConfirmAnswer, ConfirmPermission } from "../contracts/index.js";
import type { RunObserver } from "./types.js";

const DISMISSED: ConfirmAnswer = { decision: "dismissed" };

/** The decision of an adapter's answer, read once as an own data property; `dismissed` for anything else. */
export function answerOf(answer: unknown): ConfirmAnswer {
  try {
    if (typeof answer !== "object" || answer === null) return DISMISSED;
    const field = Object.getOwnPropertyDescriptor(answer, "decision");
    if (field === undefined || !("value" in field)) return DISMISSED;
    const decision: unknown = field.value;
    return (CONFIRM_ANSWER_DECISIONS as readonly unknown[]).includes(decision) ? { decision: decision as ConfirmAnswer["decision"] } : DISMISSED;
  } catch {
    return DISMISSED;
  }
}

/** EngineDeps.confirm for a run whose observer is `observer` (absent: every question is dismissed). */
export function confirmThrough(observer: RunObserver | undefined): ConfirmPermission {
  return async (request, signal) => {
    let ask: RunObserver["confirm"];
    try {
      ask = observer?.confirm;
    } catch {
      return DISMISSED;
    }
    if (typeof ask !== "function") return DISMISSED;
    try {
      return answerOf(await ask.call(observer, request, signal));
    } catch {
      return DISMISSED;
    }
  };
}
