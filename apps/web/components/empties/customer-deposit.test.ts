import { describe, expect, it } from "vitest";
import { parseDepositAmountKobo } from "./customer-deposit";

describe("deposit amount parsing", () => {
  it("accepts whole positive kobo only", () => {
    expect(parseDepositAmountKobo("500000")).toBe(500000n);
    expect(parseDepositAmountKobo(" 1 ")).toBe(1n);
  });

  it("rejects empty, zero, negative and fractional values", () => {
    for (const value of ["", "0", "-5", "12.5", "1e3", "abc", "007"]) {
      expect(parseDepositAmountKobo(value), value).toBeNull();
    }
  });
});
