/**
 * Exact percent-text <-> basis-point conversion. String handling and integer
 * arithmetic only: no parseFloat, no float multiplication, no silent rounding.
 */

export const MAX_BPS = 10_000;

export type BpsParseResult =
  | { ok: true; bps: number }
  | { ok: false; error: string };

const PERCENT_PATTERN = /^(\d{1,3})(?:\.(\d{1,2}))?$/;
const TOO_MANY_DECIMALS = /^\d+\.\d{3,}$/;

/**
 * "87.5" -> 8750, "87.55" -> 8755, "100" -> 10000, "0" -> 0.
 * Accepts one optional trailing "%". Rejects empty text, negatives, three or
 * more decimals, non-numbers and anything above 100.00.
 */
export function parsePercentToBps(text: string): BpsParseResult {
  const trimmed = text.trim();
  const body = trimmed.endsWith("%") ? trimmed.slice(0, -1).trim() : trimmed;

  if (body === "") return { ok: false, error: "Enter a percentage." };
  if (body.startsWith("-")) {
    return { ok: false, error: "A percentage cannot be negative." };
  }
  if (TOO_MANY_DECIMALS.test(body)) {
    return { ok: false, error: "Use at most 2 decimal places." };
  }

  const match = PERCENT_PATTERN.exec(body);
  if (match === null) {
    return { ok: false, error: "Enter a number between 0 and 100." };
  }

  const whole = Number.parseInt(match[1], 10);
  const hundredths = Number.parseInt((match[2] ?? "").padEnd(2, "0"), 10);
  const bps = whole * 100 + hundredths;

  if (bps > MAX_BPS) {
    return { ok: false, error: "A percentage cannot be above 100." };
  }
  return { ok: true, bps };
}

/** 8750 -> "87.5%", 8755 -> "87.55%", 10000 -> "100%", 25000 -> "250%". */
export function formatBps(bps: number | null): string {
  if (bps === null) return "—";
  const whole = Math.trunc(bps / 100);
  const hundredths = Math.abs(bps % 100);
  if (hundredths === 0) return `${whole}%`;
  const fraction = String(hundredths).padStart(2, "0").replace(/0$/, "");
  return `${whole}.${fraction}%`;
}
