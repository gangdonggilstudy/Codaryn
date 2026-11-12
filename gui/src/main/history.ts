/**
 * GU-4 (docs/design/standalone-gui.md 3.8, 6.6): what the main process remembers between the run
 * list, a revert preview and the revert. No Electron, so this is tested under Node.
 * - The run ids of the last list of each workspace: a preview is asked only for a run the person
 *   chose from that list (the GUI never uses "latest").
 * - A preview token for each preview: the revert takes only this token, never a run id from the
 *   window, and the main process asks the person (an OS dialog) with the preview's counts before
 *   it reverts. A token works once, for a short time, and the workspace closing forgets it.
 */

export interface RevertPreview {
  readonly workspace: string;
  readonly runId: string;
  readonly reverted: number;
  readonly skipped: number;
}

/** How long a preview token works. */
export const PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_PREVIEWS = 16;

/** DR-25: what the main process asks the person about before reverting again with the consent. */
export interface ConsentRetry {
  readonly workspace: string;
  readonly runId: string;
  /** Files the revert skipped as unsafe_move. */
  readonly files: number;
}

export class RunHistory {
  private readonly listed = new Map<string, Set<string>>();
  private readonly previews = new Map<string, RevertPreview & { readonly at: number }>();
  private readonly retries = new Map<string, ConsentRetry & { readonly at: number }>();

  constructor(
    private readonly randomBytes: (size: number) => Uint8Array,
    private readonly now: () => number,
  ) {}

  /** The run ids of the workspace's newest list. */
  listedRuns(workspace: string, runIds: readonly string[]): void {
    this.listed.set(workspace, new Set(runIds));
  }

  wasListed(workspace: string, runId: string): boolean {
    return this.listed.get(workspace)?.has(runId) === true;
  }

  /** A new token for this preview. The oldest are forgotten past MAX_PREVIEWS. */
  issuePreview(preview: RevertPreview): string {
    const token = Array.from(this.randomBytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (this.previews.size >= MAX_PREVIEWS) this.previews.delete(this.previews.keys().next().value as string);
    this.previews.set(token, { ...preview, at: this.now() });
    return token;
  }

  /** The preview of a token, which then stops working; null when unknown or too old. */
  takePreview(token: string): RevertPreview | null {
    const preview = this.previews.get(token);
    if (preview === undefined) return null;
    this.previews.delete(token);
    if (this.now() - preview.at > PREVIEW_TTL_MS) return null;
    return { workspace: preview.workspace, runId: preview.runId, reverted: preview.reverted, skipped: preview.skipped };
  }

  /**
   * DR-25: a revert skipped files as `unsafe_move`; a token to revert that run once more, with the
   * person's consent asked by the main process. Only a revert's own result issues one.
   */
  issueConsentRetry(retry: ConsentRetry): string {
    const token = Array.from(this.randomBytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (this.retries.size >= MAX_PREVIEWS) this.retries.delete(this.retries.keys().next().value as string);
    this.retries.set(token, { ...retry, at: this.now() });
    return token;
  }

  /** The retry of a token, which then stops working; null when unknown or too old. */
  takeConsentRetry(token: string): ConsentRetry | null {
    const retry = this.retries.get(token);
    if (retry === undefined) return null;
    this.retries.delete(token);
    if (this.now() - retry.at > PREVIEW_TTL_MS) return null;
    return { workspace: retry.workspace, runId: retry.runId, files: retry.files };
  }

  /** Forgets a workspace's list, previews and retries (its handle is gone). */
  forget(workspace: string): void {
    this.listed.delete(workspace);
    for (const [token, preview] of this.previews) if (preview.workspace === workspace) this.previews.delete(token);
    for (const [token, retry] of this.retries) if (retry.workspace === workspace) this.retries.delete(token);
  }

  clear(): void {
    this.listed.clear();
    this.previews.clear();
    this.retries.clear();
  }
}
