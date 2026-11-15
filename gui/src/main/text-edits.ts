/**
 * U-184 (DR-72; docs/design/standalone-gui.md 3.14, 6.5): the text view's edit tokens. Opening an
 * editable file gives the page a token; the main process keeps what it stands for: the workspace
 * handle, the file's path relative to it, and the digest it was read with (the next write's base).
 * The page saves with the token and the text only, never a path. Whether the person agreed to save
 * to this file is kept with it: the main process asks once per opened file (principle 6, GUI-D22).
 * A save replaces the token (the file is now what was written); settings written drop them all
 * (U-123's treeReset), as a closed workspace does.
 */

/** At most this many opened files keep a token; the oldest goes first. */
export const MAX_TEXT_EDITS = 32;

export interface TextEdit {
  readonly workspace: string;
  readonly path: string;
  readonly digest: string;
  /** The person agreed, in the main process's dialog, to save to this file. */
  readonly confirmed: boolean;
}

export class TextEdits {
  private readonly edits = new Map<string, TextEdit>();
  /** Tokens whose save goes on now (a second save of the same file waits for none: it is refused). */
  private readonly saving = new Set<string>();

  constructor(private readonly randomBytes: (size: number) => Uint8Array) {}

  private token(): string {
    return Array.from(this.randomBytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  /** A token for a file opened editable. */
  issue(workspace: string, path: string, digest: string, confirmed = false): string {
    const token = this.token();
    this.edits.set(token, { workspace, path, digest, confirmed });
    while (this.edits.size > MAX_TEXT_EDITS) this.edits.delete(this.edits.keys().next().value as string);
    return token;
  }

  get(token: unknown): TextEdit | null {
    return typeof token === "string" ? (this.edits.get(token) ?? null) : null;
  }

  /** The person agreed to save to this file (asked once per opened file). */
  confirm(token: string): void {
    const edit = this.edits.get(token);
    if (edit !== undefined) this.edits.set(token, { ...edit, confirmed: true });
  }

  /** Marks a save under way; false when one is already. */
  begin(token: string): boolean {
    if (this.saving.has(token)) return false;
    this.saving.add(token);
    return true;
  }

  end(token: string): void {
    this.saving.delete(token);
  }

  /** After a write: the old token goes, a new one stands for the file as written (agreement kept). */
  replace(token: string, digest: string): string | null {
    const edit = this.edits.get(token);
    if (edit === undefined) return null;
    this.edits.delete(token);
    return this.issue(edit.workspace, edit.path, digest, edit.confirmed);
  }

  clear(): void {
    this.edits.clear();
    this.saving.clear();
  }
}
