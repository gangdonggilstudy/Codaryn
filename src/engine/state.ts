/**
 * Run state machine. Only transitions listed in RUN_TRANSITIONS are possible.
 */

import { RUN_TRANSITIONS } from "../contracts/index.js";
import type { RunStatus } from "../contracts/index.js";

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: RunStatus,
    readonly to: RunStatus,
  ) {
    super(`invalid run transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export class RunState {
  #status: RunStatus = "created";

  get status(): RunStatus {
    return this.#status;
  }

  /** Moves to `to`, or throws InvalidTransitionError and leaves the status unchanged. */
  transition(to: RunStatus): void {
    if (!canTransition(this.#status, to)) {
      throw new InvalidTransitionError(this.#status, to);
    }
    this.#status = to;
  }
}
