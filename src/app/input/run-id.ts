/** runId: `<UTC yyyymmddThhmmssZ>-<8 lowercase hex>` (PM decision P-3). */

export const RUN_ID_PATTERN = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;

export function createRunId(now: Date, randomBytes: (size: number) => Uint8Array): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const hex = Array.from(randomBytes(4), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${stamp}-${hex}`;
}
