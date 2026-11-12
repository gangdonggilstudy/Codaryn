/**
 * The only way the page builds elements: text goes in with textContent, attributes with
 * setAttribute. No HTML is ever parsed from a value (docs/design/standalone-gui.md 6.2).
 */

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, attrs: Readonly<Record<string, string>> = {}): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

export function button(text: string, onClick: () => void, attrs: Readonly<Record<string, string>> = {}): HTMLButtonElement {
  const node = el("button", text, { type: "button", ...attrs });
  node.addEventListener("click", onClick);
  return node;
}
