/** Shared values of one run; collection and state references stay fixed while their contents change. */
import type { FileChangeRecord, MaskedText, ModelMessage, RunModelError, VerifierResult } from "../contracts/index.js";
import type { ProposedPlan } from "./pure.js";
import type { RunState } from "./state.js";

export interface RunTally {
  proposedPlan: ProposedPlan | null;
  planSummary: MaskedText | null;
  reviewChecklist: readonly MaskedText[] | null;
  readonly state: RunState;
  modelTurns: number;
  toolCalls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  readonly changes: FileChangeRecord[];
  readonly verifierResults: VerifierResult[];
  readonly notices: MaskedText[];
  readonly messages: ModelMessage[];
  repairAttempts: number;
  maskedPlaces: number;
  lastFinal: MaskedText | null;
  endingModelError: RunModelError | null;
}
