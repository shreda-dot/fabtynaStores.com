import { describe, expect, it } from "vitest";
import {
  computeSaleLineTotalKobo,
  parseQuantityText,
  quantityToWholeUnits,
} from "../domain/operations.ts";

function scaled(text: string): bigint {
  const r = parseQuantityText(text);
  if (!r.ok) throw new Error(r.message);
  return r.scaledQuantity;
}

describe("parseQuantityText", () => {
  it("accepts whole and up to 4 decimals", () => {
    expect(scaled("2")).toBe(20000n);
    expect(scaled("592.05")).toBe(5920500n);
    expect(scaled("0.0001")).toBe(1n);
  });

  it("rejects exponent, 5 decimals, zero, negatives and junk", () => {
    for (const bad of ["1e3", "0.00001", "0", "0.0000", "-1", "", "1,5", "abc", ".5"]) {
      expect(parseQuantityText(bad).ok).toBe(false);
    }
  });

  it("gives a JSON number only after exact validation", () => {
    const r = parseQuantityText("592.05");
    expect(r.ok && r.jsonNumber).toBe(592.05);
  });
});

describe("computeSaleLineTotalKobo", () => {
  it("592.05 x 50769390 = 30058017350 (float gives ...349)", () => {
    // 5920500 * 50769390 = 300580173495000 ; / 10000 = 30058017349.5 -> half-up 30058017350
    expect(computeSaleLineTotalKobo(scaled("592.05"), 50769390n)).toBe(30058017350n);
  });

  it("exact half rounds up", () => {
    // 0.5 x 1 kobo = 0.5 -> 1
    expect(computeSaleLineTotalKobo(scaled("0.5"), 1n)).toBe(1n);
  });

  it("4-decimal case: 0.0001 x 10000 = 1 kobo", () => {
    expect(computeSaleLineTotalKobo(scaled("0.0001"), 10000n)).toBe(1n);
  });

  it("whole quantity is exact", () => {
    expect(computeSaleLineTotalKobo(scaled("3"), 12550n)).toBe(37650n);
  });
});

describe("quantityToWholeUnits", () => {
  it("half a 24-pack is 12 units", () => {
    expect(quantityToWholeUnits(scaled("0.5"), "PACK", 24)).toBe(12n);
  });
  it("rejects a fractional result", () => {
    expect(quantityToWholeUnits(scaled("0.5"), "PACK", 5)).toBeNull();
    expect(quantityToWholeUnits(scaled("1.5"), "UNIT", 24)).toBeNull();
  });
  it("whole unit quantity passes", () => {
    expect(quantityToWholeUnits(scaled("7"), "UNIT", 24)).toBe(7n);
  });
});
