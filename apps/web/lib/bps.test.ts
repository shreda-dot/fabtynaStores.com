import { describe, expect, it } from "vitest";
import { formatBps, parsePercentToBps } from "./bps";

function bps(text: string): number {
  const result = parsePercentToBps(text);
  if (!result.ok) throw new Error(`expected ok for "${text}": ${result.error}`);
  return result.bps;
}

describe("parsePercentToBps accepts", () => {
  it.each([
    ["0", 0],
    ["100", 10000], // 100 * 100
    ["100.00", 10000],
    ["87.5", 8750], // 87*100 + 50
    ["87.55", 8755], // 87*100 + 55
    ["87.05", 8705], // 87*100 + 5 (leading zero decimal)
    ["0.01", 1],
    ["5%", 500], // trailing % allowed
    ["  12  ", 1200],
  ])("%s -> %i bps", (text, expected) => {
    expect(bps(text)).toBe(expected);
  });
});

describe("parsePercentToBps rejects without rounding", () => {
  it.each([
    ["87.555", "3 decimals"],
    ["100.01", "above 100.00"],
    ["101", "above 100"],
    ["-1", "negative"],
    ["", "empty"],
    ["   ", "blank"],
    ["abc", "not a number"],
    ["1e2", "exponent"],
    [".5", "no integer part"],
    ["1,5", "comma"],
  ])("%s (%s)", (text) => {
    expect(parsePercentToBps(text).ok).toBe(false);
  });

  it("names the decimal limit", () => {
    const result = parsePercentToBps("87.555");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/2 decimal/);
  });
});

describe("formatBps", () => {
  it("formats exactly", () => {
    expect(formatBps(8750)).toBe("87.5%");
    expect(formatBps(10000)).toBe("100%");
    expect(formatBps(25000)).toBe("250%");
    expect(formatBps(null)).toBe("—");
  });
});
