/** Internal store read: one statted handle, at most max bytes plus one detection byte. */
import { open } from "node:fs/promises";

/** Oversize is distinct so the state guard can keep its existing metadata-only limit result. */
export async function readBounded(file: string, max: number): Promise<Buffer | "too_large"> {
  if (!Number.isSafeInteger(max) || max < 0) throw new RangeError("invalid read budget");
  const handle = await open(file, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("not a regular record file");
    if (info.size > max) return "too_large";
    const buffer = Buffer.alloc(Math.min(64 * 1024, max + 1));
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, max - total + 1), null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > max) return "too_large";
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

/** UTF-8 as readFile(..., "utf8") decoded it; oversize follows the caller's existing read-error path. */
export async function readBoundedText(file: string, max: number): Promise<string> {
  const bytes = await readBounded(file, max);
  if (bytes === "too_large") throw new RangeError("record exceeds its read budget");
  return bytes.toString("utf8");
}
