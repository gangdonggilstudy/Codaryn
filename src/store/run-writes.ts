/**
 * DR-38: how the run's own writers (journal, change recorder, plan recorder, marks) tell the state
 * guard what they wrote, so a later comparison does not count those writes as changes
 * (state-guard.ts). Writers made without notes (the plain factories) write as before.
 */

export interface RunWriteNotes {
  /** The run left `file` (absolute, below the state directory) with this content: SHA-256 and size in bytes. */
  file(file: string, content: { readonly sha256: string; readonly size: number }): Promise<void>;
  /** The run made the directory `dir` (absolute); it and its parents below the state directory are noted. */
  dir(dir: string): Promise<void>;
  /** The run left `file` as it is now, by its metadata (a file it moved there rather than wrote). */
  present(file: string): Promise<void>;
}
