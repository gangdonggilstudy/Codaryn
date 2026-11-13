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

/** One changed file as a result (`{path, created}`) or the changes view (also `state`) gives it. */
export interface ChangeMarkSource {
  readonly path: string;
  readonly created: boolean;
  readonly state?: string;
}

export interface ChangeMark {
  readonly created: boolean;
  /** The changes view's state (`as_run_left`, `changed_since_run`, ...); null from a result. */
  readonly state: string | null;
}

/** At most this many files are marked; a run with more marks the first ones. */
export const MAX_MARKED_FILES = 10_000;

export class ChangeMarks {
  private readonly files = new Map<string, ChangeMark>();
  private readonly folders = new Set<string>();

  constructor(
    readonly run: MarkedRun,
    sources: readonly ChangeMarkSource[],
  ) {
    for (const source of sources.slice(0, MAX_MARKED_FILES)) {
      const path = source.path.replace(/^(\.\/)+/, "");
      if (path === "" || path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) continue;
      this.files.set(path, { created: source.created, state: typeof source.state === "string" ? source.state : null });
      const segments = path.split("/");
      for (let end = 1; end < segments.length; end += 1) this.folders.add(segments.slice(0, end).join("/"));
    }
  }

  /** How many files are marked. */
  get size(): number {
    return this.files.size;
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
