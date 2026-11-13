/**
 * GU-5 (docs/design/standalone-gui.md 3.9, 6.6): the plans the window showed and may apply. No
 * Electron, so this is tested under Node.
 * - A plan view of a pending plan gets an approval token. The apply takes this token only; the
 *   main process applies the digest it got with the view (the plan the person saw), never one from
 *   the window, and asks the person in an OS dialog first.
 * - DR-21: when an apply ended as `consent_required`, its token may ask once more, now for the
 *   consent to the unsafe moves, again in the main process's own dialog. The consent is made from
 *   that answer only, for this plan's digest, for that one apply.
 * - A token works for a while and is forgotten once its apply ended otherwise, or the workspace closed.
 */

export interface PlanApproval {
  readonly workspace: string;
  readonly profile: string | null;
  /** R-14 L-3: the task kind the plan run was started with, or null. */
  readonly workflowRef: string | null;
  readonly planRunId: string;
  readonly digest: string;
  readonly moves: number;
  readonly discards: number;
  /**
   * U-206 (U-196): a run plan's approval: its check is indexed by its files. Its apply is not this
   * app's yet (the app layer's apply of a run plan comes with U-195): the main process refuses it.
   */
  readonly planKind?: "changes";
  readonly files?: number;
  /** The last apply of this plan ended as `consent_required`. */
  readonly consentRequired: boolean;
}

export const APPROVAL_TTL_MS = 30 * 60 * 1000;
const MAX_APPROVALS = 8;

export class PlanApprovals {
  private readonly approvals = new Map<string, PlanApproval & { readonly at: number }>();
  /** The apply run that goes on, and the token it came from. */
  private applying: { readonly runId: string; readonly token: string } | null = null;

  constructor(
    private readonly randomBytes: (size: number) => Uint8Array,
    private readonly now: () => number,
  ) {}

  issue(approval: Omit<PlanApproval, "consentRequired">): string {
    const token = Array.from(this.randomBytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (this.approvals.size >= MAX_APPROVALS) this.approvals.delete(this.approvals.keys().next().value as string);
    this.approvals.set(token, { ...approval, consentRequired: false, at: this.now() });
    return token;
  }

  /** The approval of a token, or null when unknown or too old. */
  get(token: string): PlanApproval | null {
    const approval = this.approvals.get(token);
    if (approval === undefined) return null;
    if (this.now() - approval.at > APPROVAL_TTL_MS) {
      this.approvals.delete(token);
      return null;
    }
    return approval;
  }

  /** Whether this token may ask for the DR-21 consent now (its last apply ended as consent_required). */
  mayAskConsent(token: string): boolean {
    return this.get(token)?.consentRequired === true && this.applying === null;
  }

  /** An apply of this token's plan began as run `runId`. */
  applied(token: string, runId: string): void {
    this.applying = { runId, token };
    const approval = this.approvals.get(token);
    if (approval !== undefined) this.approvals.set(token, { ...approval, consentRequired: false });
  }

  /** A run ended; for this token's apply, keep it for the consent question or forget it. */
  ended(runId: string, reason: string | null): void {
    const applying = this.applying;
    if (applying === null || applying.runId !== runId) return;
    this.applying = null;
    const approval = this.approvals.get(applying.token);
    if (approval === undefined) return;
    if (reason === "consent_required") this.approvals.set(applying.token, { ...approval, consentRequired: true });
    else this.approvals.delete(applying.token);
  }

  forget(workspace: string): void {
    for (const [token, approval] of this.approvals) if (approval.workspace === workspace) this.approvals.delete(token);
  }

  clear(): void {
    this.approvals.clear();
    this.applying = null;
  }
}
