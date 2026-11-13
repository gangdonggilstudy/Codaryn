/**
 * The apply run for an adapter (adapter-contract 5.6; DR-1, DR-2, DR-21, R-9 I-4).
 *
 * - `applyArguments`: the `codaryn apply` arguments for a request. The CLI parses and judges them;
 *   the approval and the consent travel through `AdapterApply`, never as arguments.
 * - `applyJournalWithEvents`: the apply's events, built in memory from what the engine appends,
 *   as run events are (DR-15). The journal file is never read back.
 *   - `seq` and `at` are the stored entry's own (AC-D3, the CLI migration's C-2, U-262): the journal
 *     resolves with the entry as it wrote it, so an event and its stored line are the same record.
 *   - `plan_item_started` (R-9 I-4) is stored but not delivered: it is the revert's record of an
 *     action begun, not progress for a person, and ApplyEvent carries ApplyJournalRecord only. Its
 *     number is skipped.
 *   - Every string is masked again with the apply's gateway. A record that cannot be masked is
 *     not delivered; the gap in `seq` shows it.
 */

import type { ApplyJournal, ApplyJournalRecord, PrivacyGateway } from "../contracts/index.js";
import { maskStrings } from "./events.js";
import type { ApplyEvent, ApplyObserver, ApplyPlanRequest, TaskForm } from "./types.js";

/** The task form's arguments (DR-17), as `plan`, `apply` and `review` take them. */
export function taskFormArguments(settings: TaskForm): string[] {
  const argv: string[] = [];
  if (settings.input.kind === "task") argv.push("--task", settings.input.taskPath);
  else argv.push("--workspace", settings.input.workspace);
  if (settings.configPath !== null) argv.push("--config", settings.configPath);
  if (settings.varsFile !== null) argv.push("--vars-file", settings.varsFile);
  if (settings.profile !== null) argv.push("--profile", settings.profile);
  if (settings.workflowRef !== null) argv.push("--workflow", settings.workflowRef);
  return argv;
}

/** `codaryn apply` for a request: the task form, the plan run, the approved digest, the cancel file. */
export function applyArguments(request: Pick<ApplyPlanRequest, "settings" | "planRunId" | "digest" | "cancelFile">): string[] {
  const argv = ["apply", ...taskFormArguments(request.settings), "--run", request.planRunId, "--digest", request.digest, "--quiet"];
  if (request.cancelFile !== null) argv.push("--cancel-file", request.cancelFile);
  return argv;
}

/** Delivers one apply event. An observer's exception or absence never reaches the apply. */
export function deliverApply(observer: ApplyObserver | undefined, event: ApplyEvent): void {
  if (observer?.onEvent === undefined) return;
  try {
    observer.onEvent(event);
  } catch {
    // An observer cannot change the apply.
  }
}

/** Wraps the apply's journal so each stored record is delivered to `observer`, start records left out. */
export function applyJournalWithEvents(journal: ApplyJournal, observer: ApplyObserver | undefined, privacy: PrivacyGateway): ApplyJournal {
  if (observer?.onEvent === undefined) return journal;
  return {
    async append(entry) {
      const stored = await journal.append(entry);
      if (stored.type === "plan_item_started") return stored;
      const shown = maskStrings(stored as ApplyJournalRecord, privacy);
      if (shown !== null) deliverApply(observer, { kind: "record", record: shown });
      return stored;
    },
    close: () => journal.close(),
  };
}
