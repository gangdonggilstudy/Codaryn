/**
 * GU-6 (3.10): the models of the last list a person asked for, by entry id. The window chooses a
 * model by the entry id it was shown, so it can only choose a model the API listed; it never sends
 * a model id to write into the config file (6.6). A new list makes the old ids stop working. No
 * Electron, so this is tested under Node.
 */

import type { HostModelEntry, ModelEntryView } from "../shared/ipc.js";

export class ModelEntries {
  private readonly entries = new Map<string, { readonly provider: string; readonly id: string }>();

  constructor(private readonly randomBytes: (size: number) => Uint8Array) {}

  /** Forgets the earlier list and gives each listed model a fresh entry id. */
  issue(provider: string, models: readonly HostModelEntry[]): ModelEntryView[] {
    this.entries.clear();
    return models.map((model) => {
      const entry = Array.from(this.randomBytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("");
      this.entries.set(entry, { provider, id: model.id });
      return { entry, number: model.number, id: model.shown, name: model.name };
    });
  }

  /** The provider and the exact model id of an entry the last list gave out, or null. */
  resolve(entry: string): { readonly provider: string; readonly id: string } | null {
    return this.entries.get(entry) ?? null;
  }

  clear(): void {
    this.entries.clear();
  }
}
