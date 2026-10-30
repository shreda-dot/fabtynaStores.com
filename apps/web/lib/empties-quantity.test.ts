import { describe, expect, it } from "vitest";
import { parseEmptiesQuantityText } from "./empties-quantity";

describe("parseEmptiesQuantityText", () => {
  it("accepts a whole positive count and trims whitespace", () => {
    expect(parseEmptiesQuantityText("24")).toEqual({ ok: true, quantity: 24 });
    expect(parseEmptiesQuantityText("  48 ")).toEqual({ ok: true, quantity: 48 });
  });

  it("rejects decimals, blanks, zero and negatives for a plain count", () => {
    expect(parseEmptiesQuantityText("1.5").ok).toBe(false);
    expect(parseEmptiesQuantityText("1,000").ok).toBe(false);
    expect(parseEmptiesQuantityText("").ok).toBe(false);
    expect(parseEmptiesQuantityText("   ").ok).toBe(false);
    expect(parseEmptiesQuantityText("0").ok).toBe(false);
    expect(parseEmptiesQuantityText("-3").ok).toBe(false);
    expect(parseEmptiesQuantityText("+3").ok).toBe(false);
  });

  it("allows a signed, non-zero adjustment when allowNegative is set", () => {
    expect(parseEmptiesQuantityText("-5", { allowNegative: true })).toEqual({
      ok: true,
      quantity: -5,
    });
    expect(parseEmptiesQuantityText("5", { allowNegative: true })).toEqual({
      ok: true,
      quantity: 5,
    });
    expect(parseEmptiesQuantityText("0", { allowNegative: true }).ok).toBe(false);
    expect(parseEmptiesQuantityText("2.5", { allowNegative: true }).ok).toBe(false);
  });

  it("rejects values that are not safe integers", () => {
    expect(parseEmptiesQuantityText("99999999999999999999").ok).toBe(false);
  });
});
