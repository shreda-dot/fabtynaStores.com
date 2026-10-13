import { describe, expect, it } from "vitest";
import { formatNaira, parseMoneyInputToKobo } from "../money.js";

describe("parseMoneyInputToKobo", () => {
  it("parses whole naira into kobo", () => {
    expect(parseMoneyInputToKobo("123")).toBe("12300");
    expect(parseMoneyInputToKobo("0")).toBe("0");
  });

  it("parses naira with kobo fractions", () => {
    expect(parseMoneyInputToKobo("123.45")).toBe("12345");
    expect(parseMoneyInputToKobo("123.4")).toBe("12340");
    expect(parseMoneyInputToKobo("0.50")).toBe("50");
    expect(parseMoneyInputToKobo(".50")).toBe("50");
  });

  it("allows thousands separators", () => {
    expect(parseMoneyInputToKobo("1,234.56")).toBe("123456");
    expect(parseMoneyInputToKobo("1,234,567")).toBe("123456700");
  });

  it("trims surrounding whitespace", () => {
    expect(parseMoneyInputToKobo("  123.45  ")).toBe("12345");
  });

  it("rejects empty values", () => {
    expect(() => parseMoneyInputToKobo("")).toThrow("Amount must not be empty.");
    expect(() => parseMoneyInputToKobo("   ")).toThrow("Amount must not be empty.");
  });

  it("rejects negative values", () => {
    expect(() => parseMoneyInputToKobo("-1")).toThrow("Amount must not be negative.");
    expect(() => parseMoneyInputToKobo("1-2")).toThrow();
  });

  it("rejects more than two decimal places", () => {
    expect(() => parseMoneyInputToKobo("123.456")).toThrow();
    expect(() => parseMoneyInputToKobo("123.4567")).toThrow();
  });

  it("rejects a decimal separator without fractional digits", () => {
    expect(() => parseMoneyInputToKobo("123.")).toThrow();
  });

  it("rejects non-numeric input", () => {
    expect(() => parseMoneyInputToKobo("abc")).toThrow();
    expect(() => parseMoneyInputToKobo("12.34.56")).toThrow();
    expect(() => parseMoneyInputToKobo("1,23")).toThrow();
  });
});

describe("formatNaira", () => {
  it("formats kobo as naira currency", () => {
    expect(formatNaira("12345")).toContain("123.45");
    expect(formatNaira(12300n)).toContain("123.00");
  });

  it("formats negative amounts", () => {
    expect(formatNaira(-12345n)).toContain("123.45");
    expect(formatNaira(-50n)).toMatch(/-.*0\.50/);
  });
});
