/**
 * GU-6 (3.10): the models of the last list a person asked for, by entry id. The window chooses a
 * model by the entry id it was shown, so it can only choose a model the API listed; it never sends
 * a model id to write into the config file (6.6). A new list makes the old ids stop working. No
 * Electron, so this is tested under Node.
 */

import type { HostModelEntry, ModelEntryView } from "../shared/ipc.js";

/**
 * R21-I-3: how often the window may make the main process ask the provider's API for its model
 * list. The settings screen asks only when the person presses "get the list" (3.10, Y-2); this
 * bounds what a page that misbehaved could do with the key: one request at a time, at most
 * MAX_LISTS_PER_MINUTE in a minute.
 */
export const MAX_LISTS_PER_MINUTE = 5;

export class ModelListLimit {
  private inFlight = false;
  private readonly started: number[] = [];

  constructor(private readonly now: () => number) {}

  /** True when a list may be asked for now (and counts it); false when one is going on or too many were. */
  begin(): boolean {
    const now = this.now();
    while (this.started.length > 0 && now - (this.started[0] as number) >= 60_000) this.started.shift();
    if (this.inFlight || this.started.length >= MAX_LISTS_PER_MINUTE) return false;
    this.inFlight = true;
    this.started.push(now);
    return true;
  }

  end(): void {
    this.inFlight = false;
  }
}

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
