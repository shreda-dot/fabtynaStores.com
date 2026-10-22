import { describe, expect, it } from "vitest";
import { inclusiveDays, validateReportRange } from "./report-range";

describe("report range cap (inclusive, same as resolveListDateRange)", () => {
  it("counts both ends", () => {
    expect(inclusiveDays("2026-01-01", "2026-01-01")).toBe(1);
    // 2026 is not a leap year: Jan 1 .. Dec 31 = 365 days
    expect(inclusiveDays("2026-01-01", "2026-12-31")).toBe(365);
  });

  it("allows exactly 366 days", () => {
    // 2027-01-01 inclusive = 366 days from 2026-01-01
    expect(validateReportRange("2026-01-01", "2027-01-01")).toBeNull();
  });

  it("rejects 367 days", () => {
    expect(validateReportRange("2026-01-01", "2027-01-02")).toMatch(/366/);
  });

  it("rejects from after to", () => {
    expect(validateReportRange("2026-02-02", "2026-02-01")).not.toBeNull();
  });

  it("rejects bad or empty dates", () => {
    expect(validateReportRange("", "2026-02-01")).not.toBeNull();
    expect(validateReportRange("2026-13-45", "2026-02-01")).not.toBeNull();
  });
});
