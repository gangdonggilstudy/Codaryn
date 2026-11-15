/**
 * U-70 (docs/design/standalone-gui.md 4.5): where the window opens. The size and place it was left
 * in are used only when enough of them lies on one display's work area now (a display may have gone
 * or moved since); a window larger than that area is made to fit it. Otherwise the default size.
 */

import type { WindowBounds } from "./gui-state.js";

/** How much of the window's width and height must be on one display. */
export const MIN_VISIBLE = 100;

export interface WorkArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function fitBounds(bounds: WindowBounds | null, areas: readonly WorkArea[]): WindowBounds | null {
  if (bounds === null) return null;
  for (const area of areas) {
    const across = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const down = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    if (across >= MIN_VISIBLE && down >= MIN_VISIBLE) {
      return { x: bounds.x, y: bounds.y, width: Math.min(bounds.width, area.width), height: Math.min(bounds.height, area.height) };
    }
  }
  return null;
}
