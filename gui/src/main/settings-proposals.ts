/**
 * GU-6 (docs/design/standalone-gui.md 3.10, 6.6): the settings change proposals the window was
 * shown. A proposal's new config stays here; the window gets a token, the changed fields and the
 * widening kinds. Applying takes the token only: the main process writes the config it proposed
 * (with the base digest the proposal saw), and asks the person first when it widens. A token works
 * once and for a while. No Electron, so this is tested under Node.
 */

export interface SettingsProposal {
  readonly next: Record<string, unknown>;
  readonly baseDigest: string;
  readonly changes: readonly { readonly field: string; readonly change: string }[];
  readonly widening: readonly { readonly kind: string; readonly field: string }[];
}

export const PROPOSAL_TTL_MS = 10 * 60 * 1000;
const MAX_PROPOSALS = 8;

export class SettingsProposals {
  private readonly proposals = new Map<string, SettingsProposal & { readonly at: number }>();

  constructor(
    private readonly randomBytes: (size: number) => Uint8Array,
    private readonly now: () => number,
  ) {}

  issue(proposal: SettingsProposal): string {
    const token = Array.from(this.randomBytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (this.proposals.size >= MAX_PROPOSALS) this.proposals.delete(this.proposals.keys().next().value as string);
    this.proposals.set(token, { ...proposal, at: this.now() });
    return token;
  }

  /** The proposal of a token, which then stops working; null when unknown or too old. */
  take(token: string): SettingsProposal | null {
    const proposal = this.proposals.get(token);
    if (proposal === undefined) return null;
    this.proposals.delete(token);
    if (this.now() - proposal.at > PROPOSAL_TTL_MS) return null;
    return { next: proposal.next, baseDigest: proposal.baseDigest, changes: proposal.changes, widening: proposal.widening };
  }

  clear(): void {
    this.proposals.clear();
  }
}
