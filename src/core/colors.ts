import { createHash } from "node:crypto";

/** Stable color from a character key. The model/provider palette arrives with the 3D office. */
export function colorFor(key: string): string {
  const h = parseInt(createHash("sha256").update(key).digest("hex").slice(0, 4), 16) % 360;
  return `hsl(${h} 55% 55%)`;
}
