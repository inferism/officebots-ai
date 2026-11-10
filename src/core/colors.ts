import { createHash } from "node:crypto";

export const DEFAULT_COLOR = "#8b90a0";

// First match wins. Only the model string is looked at; unknown models get the default color.
const FAMILIES: [RegExp, string][] = [
  [/opus/i, "#966edc"],
  [/haiku/i, "#e6be46"],
  [/sonnet|claude/i, "#d97757"],
  [/gpt|codex|^o\d/i, "#10a37f"],
  [/gemini/i, "#508ceb"],
];

export function colorFor(model: string): string {
  for (const [re, color] of FAMILIES) if (re.test(model)) return color;
  return DEFAULT_COLOR;
}

function hslToHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Account accent: stable color from the (already hashed) account id. With no account it is the base color. */
export function accentFor(account: string | null, base: string): string {
  if (!account) return base;
  const h = parseInt(createHash("sha256").update(account).digest("hex").slice(0, 4), 16) % 360;
  return hslToHex(h, 65, 55);
}
