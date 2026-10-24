import { describe, expect, it } from "vitest";
import {
  addDays,
  inclusiveDays,
  presetRange,
  sumCustomerSales,
  validatePeriod,
} from "./customer-sales-totals";

describe("sumCustomerSales", () => {
  it("adds exact totals and ignores voided sales", () => {
    const totals = sumCustomerSales([
      { status: "COMPLETED", totalKobo: "500000", paidKobo: "500000" }, // N5,000 fully paid
      { status: "COMPLETED", totalKobo: "300000", paidKobo: "100000" }, // N3,000, N1,000 paid, owes 200,000
      { status: "VOIDED", totalKobo: "999900", paidKobo: "999900" }, // ignored
      { status: "COMPLETED", totalKobo: "250050", paidKobo: "0" }, // N2,500.50 unpaid
    ]);
    // count: 3 sales (the voided one is skipped)
    // billed: 500000 + 300000 + 250050 = 1050050
    // paid:   500000 + 100000 + 0      = 600000
    // owed:   0 + 200000 + 250050      = 450050 (= billed - paid)
    expect(totals).toEqual({
      count: 3,
      billedKobo: 1050050n,
      paidKobo: 600000n,
      owedKobo: 450050n,
    });
  });

  it("uses the API balance when it is present", () => {
    const totals = sumCustomerSales([
      { status: "COMPLETED", totalKobo: "100000", paidKobo: "30000", balanceDueKobo: "70000" },
    ]);
    expect(totals.owedKobo).toBe(70000n); // 100000 - 30000
  });

  it("returns zeros for no sales", () => {
    expect(sumCustomerSales([])).toEqual({ count: 0, billedKobo: 0n, paidKobo: 0n, owedKobo: 0n });
  });

  it("stays exact beyond the float limit", () => {
    const totals = sumCustomerSales([
      { status: "COMPLETED", totalKobo: "9007199254740993", paidKobo: "0" }, // 2^53 + 1
      { status: "COMPLETED", totalKobo: "1", paidKobo: "0" },
    ]);
    expect(totals.billedKobo).toBe(9007199254740994n); // 2^53 + 2
  });
});

describe("period helpers", () => {
  const today = "2026-10-23"; // a Friday

  it("counts days inclusively", () => {
    expect(inclusiveDays("2026-10-01", "2026-10-07")).toBe(7);
    expect(inclusiveDays(today, today)).toBe(1);
  });

  it("moves across month ends", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28"); // 2026 is not a leap year
  });

  it("builds presets from Lagos dates", () => {
    expect(presetRange("today", today)).toEqual({ from: today, to: today });
    expect(presetRange("yesterday", today)).toEqual({ from: "2026-10-22", to: "2026-10-22" });
    expect(presetRange("week", today)).toEqual({ from: "2026-10-19", to: today }); // Monday 19th
    expect(presetRange("week", "2026-10-19").from).toBe("2026-10-19"); // Monday stays Monday
    expect(presetRange("week", "2026-10-25").from).toBe("2026-10-19"); // Sunday goes back 6 days
    expect(presetRange("month", today)).toEqual({ from: "2026-10-01", to: today });
    expect(presetRange("last30", today)).toEqual({ from: "2026-09-24", to: today }); // 30 days counting today
  });

  it("validates the period", () => {
    expect(validatePeriod("2026-10-01", today, today)).toBeNull();
    expect(validatePeriod("2026-10-24", "2026-10-23", today)).toMatch(/not be after/);
    expect(validatePeriod("2026-10-23", "2026-10-24", today)).toMatch(/future/);
    expect(validatePeriod("2025-10-23", today, today)).toBeNull(); // 366 days inclusive
    expect(validatePeriod("2025-10-22", today, today)).toMatch(/at most 366/); // 367 days inclusive
    expect(validatePeriod("2026-13-01", today, today)).toBe("Choose both dates.");
    expect(validatePeriod("2026-02-30", today, today)).toBe("Choose both dates.");
    expect(validatePeriod("", today, today)).toBe("Choose both dates.");
  });
});