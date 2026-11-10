import { getLagosBusinessDate } from "@fabtyna/shared";
import { describe, expect, it } from "vitest";
import { familySupportRangePresets } from "./family-support-range";

describe("Family Support date presets", () => {
  const ranges = (instant: string) => Object.fromEntries(
    familySupportRangePresets(getLagosBusinessDate(new Date(instant)))
      .map(({ label, from, to }) => [label, { from, to }]),
  );

  it("uses Lagos midnight, not UTC midnight, including the previous month for yesterday", () => {
    const before = ranges("2026-03-31T22:59:59.999Z");
    const after = ranges("2026-03-31T23:00:00.000Z");
    expect(before["Today"]).toEqual({ from: "2026-03-31", to: "2026-03-31" });
    expect(after["Today"]).toEqual({ from: "2026-04-01", to: "2026-04-01" });
    expect(after["Yesterday"]).toEqual({ from: "2026-03-31", to: "2026-03-31" });
    expect(after["This month"]).toEqual({ from: "2026-04-01", to: "2026-04-01" });
    expect(after["Last 14 days"]).toEqual({ from: "2026-03-19", to: "2026-04-01" });
    expect(after["Last 30 days"]).toEqual({ from: "2026-03-03", to: "2026-04-01" });
  });

  it("handles leap-day yesterday and inclusive ranges across a year", () => {
    const leap = ranges("2024-03-01T10:00:00Z");
    expect(leap["Yesterday"]).toEqual({ from: "2024-02-29", to: "2024-02-29" });
    const year = ranges("2026-01-01T10:00:00Z");
    expect(year["Last 14 days"]).toEqual({ from: "2025-12-19", to: "2026-01-01" });
    expect(year["Last 30 days"]).toEqual({ from: "2025-12-03", to: "2026-01-01" });
  });
});
