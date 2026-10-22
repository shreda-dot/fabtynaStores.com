import { describe, expect, it } from "vitest";
import { listQuery, summaryQuery } from "./expenses.real";

describe("expenses list query string", () => {
  it("omits every unset param and sends only the default limit", () => {
    expect(listQuery({})).toBe("?limit=50");
  });

  it("builds from, to, limit for a plain range", () => {
    expect(listQuery({ from: "2026-10-01", to: "2026-10-02", limit: 50 })).toBe(
      "?from=2026-10-01&to=2026-10-02&limit=50",
    );
  });

  it("sends booleans as true, omits includeVoided when false, encodes q, trims q", () => {
    expect(
      listQuery({
        from: "2026-10-01",
        to: "2026-10-02",
        categoryId: "cat-1",
        channel: "BOTH",
        q: "  a b ",
        includeVoided: true,
        cursor: "abc",
        limit: 200,
      }),
    ).toBe(
      "?from=2026-10-01&to=2026-10-02&categoryId=cat-1&channel=BOTH&q=a+b&includeVoided=true&cursor=abc&limit=200",
    );
    expect(listQuery({ from: "2026-10-01", includeVoided: false, q: "   " })).toBe(
      "?from=2026-10-01&limit=50",
    );
  });
});

describe("expenses summary query string", () => {
  it("omits channel when unset", () => {
    expect(summaryQuery({ from: "2026-10-01", to: "2026-10-02" })).toBe(
      "?from=2026-10-01&to=2026-10-02",
    );
  });

  it("sends RETAIL and WHOLESALE, never BOTH (the API rejects it)", () => {
    expect(summaryQuery({ from: "2026-10-01", to: "2026-10-02", channel: "RETAIL" })).toBe(
      "?from=2026-10-01&to=2026-10-02&channel=RETAIL",
    );
    expect(summaryQuery({ from: "2026-10-01", to: "2026-10-02", channel: "BOTH" })).toBe(
      "?from=2026-10-01&to=2026-10-02",
    );
  });

  it("is empty with no options", () => {
    expect(summaryQuery({})).toBe("");
  });
});
