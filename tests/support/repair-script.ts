/**
 * Script helpers for the phase 2 repair loop. A scripted model answers requests in order, so a
 * repair flow is written as attempts: each attempt edits files and then declares completion with
 * a final text. Verifiers run after each final text; a failure with repairs left makes the engine
 * ask again, and the next attempt answers that request.
 *
 * The same steps can be replayed by the mock Messages API server (`stepsToReplies`).
 */

import type { ScriptStep } from "../../src/contracts/index.js";
import type { FileEdit } from "../fixtures/repair-project.js";
import { sha256Hex } from "./cli.js";
import { replyText, replyTools, toolUse } from "./fake-anthropic.js";
import type { FakeReply } from "./fake-anthropic.js";

export function readStep(id: string, path: string): ScriptStep {
  return { toolCalls: [{ id, name: "read_file", args: { path } }] };
}

/** `write_file` with `replace_text`, guarded by the hash of the text before the edit. */
export function editStep(id: string, edit: FileEdit): ScriptStep {
  return {
    toolCalls: [
      {
        id,
        name: "write_file",
        args: {
          path: edit.path,
          expectedHash: sha256Hex(edit.before),
          change: { kind: "replace_text", oldText: edit.oldText, newText: edit.newText },
        },
      },
    ],
  };
}

export function finalStep(text: string): ScriptStep {
  return { text };
}

export interface Attempt {
  /** Edits made in this attempt, in order. May be empty (the model only claims success). */
  readonly edits: readonly FileEdit[];
  /** Files read before editing. */
  readonly reads?: readonly string[];
  /** The completion claim. Defaults to "attempt <n>: fixed". */
  readonly claim?: string;
}

/** Call id of the k-th edit (1-based) in attempt n (1-based): `a<n>w<k>`. Reads are `a<n>r<k>`. */
export function editCallId(attempt: number, edit: number): string {
  return `a${attempt}w${edit}`;
}

export function readCallId(attempt: number, read: number): string {
  return `a${attempt}r${read}`;
}

/**
 * Steps for a sequence of attempts. Attempt 1 answers the first request; attempt n + 1 answers the
 * request that carries the failure evidence of attempt n. Throws when the edits of one file do
 * not chain (an edit's `before` must equal the previous edit's `after` for that file).
 */
export function attemptSteps(attempts: readonly Attempt[]): ScriptStep[] {
  assertEditsChain(attempts.flatMap((attempt) => attempt.edits));
  const steps: ScriptStep[] = [];
  attempts.forEach((attempt, index) => {
    const n = index + 1;
    (attempt.reads ?? []).forEach((path, k) => steps.push(readStep(readCallId(n, k + 1), path)));
    attempt.edits.forEach((edit, k) => steps.push(editStep(editCallId(n, k + 1), edit)));
    steps.push(finalStep(attempt.claim ?? `attempt ${n}: fixed`));
  });
  return steps;
}

/** Number of model turns the attempts use when every step is consumed. */
export function attemptTurns(attempts: readonly Attempt[]): number {
  return attempts.reduce((sum, attempt) => sum + (attempt.reads?.length ?? 0) + attempt.edits.length + 1, 0);
}

/**
 * Final texts appended after the planned attempts. A run that stops when it should leaves them
 * unused; a run that asks the model again uses one, which the turn count shows.
 */
export function spareSteps(count: number): ScriptStep[] {
  return Array.from({ length: count }, (_, i) => finalStep(`spare ${i + 1}: must not be requested`));
}

export function assertEditsChain(edits: readonly FileEdit[]): void {
  const current = new Map<string, string>();
  for (const edit of edits) {
    const previous = current.get(edit.path);
    if (previous !== undefined && previous !== edit.before) {
      throw new Error(`script edits of ${edit.path} do not chain`);
    }
    current.set(edit.path, edit.after);
  }
}

/** The final contents of each file after all edits, in first-edit order. */
export function finalContents(edits: readonly FileEdit[]): Map<string, string> {
  assertEditsChain(edits);
  const result = new Map<string, string>();
  for (const edit of edits) result.set(edit.path, edit.after);
  return result;
}

/**
 * Converts scripted steps into mock Messages API answers: tool calls become `tool_use` blocks
 * with the same ids, a step without tool calls becomes a final text. Usage is fixed per answer.
 */
export function stepsToReplies(steps: readonly ScriptStep[]): FakeReply[] {
  return steps.map((step, index) => {
    const calls = step.toolCalls ?? [];
    if (calls.length === 0) return replyText(step.text === undefined || step.text === "" ? "done" : step.text);
    const blocks = calls.map((call, k) =>
      toolUse(call.id ?? `toolu_${index + 1}_${k + 1}`, call.name, call.args as Readonly<Record<string, unknown>>),
    );
    return replyTools(step.text === undefined || step.text === "" ? blocks : [{ type: "text", text: step.text }, ...blocks]);
  });
}
