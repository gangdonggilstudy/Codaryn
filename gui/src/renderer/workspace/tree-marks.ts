/**
 * U-65 (docs/design/standalone-gui.md 3.3): the file tree's change marks. One run at a time: the
 * run that just ended in this window (its result's changed files) or the run whose changes view was
 * opened (its files and their states now). Paths are the masked paths those give; a tree entry is
 * matched by its shown path (pathOf), so a hidden name never matches. Pure: no DOM.
 */

/** The run the marks are of, with the task form its changes view takes. */
export interface MarkedRun {
  readonly runId: string;
  readonly profile: string | null;
  readonly workflow: string | null;
}

/**
 * One changed file as a result (`{path, created}`) or the changes view (also `state`) gives it.
 * U-271 (3.3): `moved`, a file an apply moved here (its action's `to`).
 */
export interface ChangeMarkSource {
  readonly path: string;
  readonly created: boolean;
  readonly state?: string;
  readonly moved?: true;
}

export interface ChangeMark {
  readonly created: boolean;
  /** U-271 (3.3): an apply moved the file here ("[moved here]"). Absent: a run created or changed it. */
  readonly moved?: true;
  /** The changes view's state (`as_run_left`, `changed_since_run`, ...); null from a result. */
  readonly state: string | null;
}

/** At most this many files are marked; a run with more marks the first ones. */
export const MAX_MARKED_FILES = 10_000;

export class ChangeMarks {
  private readonly files = new Map<string, ChangeMark>();
  private readonly folders = new Set<string>();

  /**
   * U-271 (3.3): `discarded`, how many files the marked apply sent to the discard box: they are no longer
   * in the workspace, so no tree entry has them, and the note above the tree says how many.
   */
  constructor(
    readonly run: MarkedRun,
    sources: readonly ChangeMarkSource[],
    readonly discarded = 0,
  ) {
    for (const source of sources.slice(0, MAX_MARKED_FILES)) {
      const path = source.path.replace(/^(\.\/)+/, "");
      if (path === "" || path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) continue;
      this.files.set(path, { created: source.created, ...(source.moved === true ? { moved: true as const } : {}), state: typeof source.state === "string" ? source.state : null });
      const segments = path.split("/");
      for (let end = 1; end < segments.length; end += 1) this.folders.add(segments.slice(0, end).join("/"));
    }
  }

  /** How many files are marked. */
  get size(): number {
    return this.files.size;
  }

  /** U-271: the marked files' paths. */
  paths(): Iterable<string> {
    return this.files.keys();
  }

  /** The mark of the file at `path`, or null. */
  file(path: string): ChangeMark | null {
    return this.files.get(path) ?? null;
  }

  /** Whether a marked file is somewhere below the folder at `path`. */
  holds(path: string): boolean {
    return this.folders.has(path);
  }
}
