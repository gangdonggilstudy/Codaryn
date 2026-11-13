/**
 * A minimal stand-in for the page's DOM, for unit tests of screens under Node (no new package).
 * It has what the screens' helpers use (src/renderer/shell/dom.ts): createElement, attributes,
 * textContent, append and replaceChildren, and click listeners. Install it before a screen is
 * built and remove it after.
 */

export class FakeElement {
  readonly children: FakeElement[] = [];
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, (() => void)[]>();
  private text = "";
  value = "";
  selected = false;

  constructor(readonly tagName: string) {}

  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value: string) {
    this.text = value;
    this.children.length = 0;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  append(...nodes: (FakeElement | string)[]): void {
    for (const node of nodes) {
      if (typeof node === "string") this.text += node;
      else this.children.push(node);
    }
  }

  replaceChildren(...nodes: FakeElement[]): void {
    this.children.length = 0;
    this.text = "";
    this.append(...nodes);
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  /** Runs the listeners of an event other than a click (for example "change"). */
  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  click(): void {
    if (this.hasAttribute("disabled")) return;
    for (const listener of this.listeners.get("click") ?? []) listener();
  }

  focus(): void {
    fakeDocument.activeElement = this;
  }

  /** Every element below this one (depth first) for which `match` holds. */
  findAll(match: (element: FakeElement) => boolean): FakeElement[] {
    const found: FakeElement[] = [];
    for (const child of this.children) {
      if (match(child)) found.push(child);
      found.push(...child.findAll(match));
    }
    return found;
  }

  /** The first element below this one with that tag name (the only selector the screens use here). */
  querySelector(selector: string): FakeElement | null {
    if (!/^[a-z][a-z0-9]*$/.test(selector)) throw new Error(`fake DOM: only a tag name selector, not ${selector}`);
    return this.findAll((element) => element.tagName === selector)[0] ?? null;
  }

  /** Whether `node` is this element or below it. */
  contains(node: FakeElement): boolean {
    return node === this || this.findAll((element) => element === node).length > 0;
  }
}

const fakeDocument = {
  activeElement: null as FakeElement | null,
  createElement: (tag: string): FakeElement => new FakeElement(tag),
  /** Document-wide listeners (the shell's keys) are not run by these tests. */
  addEventListener: (): void => undefined,
};

/** Puts the stand-in in place of `document`; returns a function that takes it away again. */
export function installFakeDom(): () => void {
  const global = globalThis as { document?: unknown };
  const before = global.document;
  global.document = fakeDocument;
  return () => {
    if (before === undefined) delete global.document;
    else global.document = before;
  };
}

/** Lets pending promise callbacks run. */
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
