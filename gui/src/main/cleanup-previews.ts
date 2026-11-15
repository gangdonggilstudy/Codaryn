/**
 * GU-4 (docs/design/standalone-gui.md 3.8, 6.6), DR-39, DR-44: the cleanup previews the window was
 * shown. The plan stays here with the selection and the moment it was counted from; the window gets
 * a token. Cleaning takes the token only: the main process asks the person (OS dialogs, the plan,
 * then apart the records of runs not reverted and the discarded files) and cleans exactly the plan
 * it showed (its digest). A token works once and for a while. No Electron, so this is tested under Node.
 */

import type { CleanupPlanView, CleanupSelectionArg } from "../shared/cleanup.js";

export interface CleanupPreviewRecord {
  /** The workspace handle the preview was made for, and its folder. */
  readonly workspace: string;
  readonly root: string;
  readonly selection: CleanupSelectionArg;
  readonly now: string;
  readonly plan: CleanupPlanView;
}

export const CLEANUP_PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_PREVIEWS = 8;

export class CleanupPreviews {
  private readonly previews = new Map<string, CleanupPreviewRecord & { readonly at: number }>();

  constructor(
    private readonly randomBytes: (size: number) => Uint8Array,
    private readonly clock: () => number,
  ) {}

  issue(record: CleanupPreviewRecord): string {
    const token = Array.from(this.randomBytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (this.previews.size >= MAX_PREVIEWS) this.previews.delete(this.previews.keys().next().value as string);
    this.previews.set(token, { ...record, at: this.clock() });
    return token;
  }

  /** The preview of a token, which then stops working; null when unknown or too old. */
  take(token: string): CleanupPreviewRecord | null {
    const record = this.previews.get(token);
    if (record === undefined) return null;
    this.previews.delete(token);
    if (this.clock() - record.at > CLEANUP_PREVIEW_TTL_MS) return null;
    return { workspace: record.workspace, root: record.root, selection: record.selection, now: record.now, plan: record.plan };
  }

  clear(): void {
    this.previews.clear();
  }
}
