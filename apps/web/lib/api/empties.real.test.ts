import { describe, expect, it } from "vitest";
import { balancesQuery, movementsQuery, ownersQuery, typesQuery } from "./empties.real";

describe("empties owners query string", () => {
  it("always states the active filter explicitly", () => {
    expect(ownersQuery({})).toBe("?includeInactive=false");
    expect(ownersQuery({ includeInactive: true })).toBe("?includeInactive=true");
  });
});

describe("empties types query string", () => {
  it("omits every unset param", () => {
    expect(typesQuery({})).toBe("");
  });

  it("sends includeInactive and ownerId when set", () => {
    expect(typesQuery({ includeInactive: true, ownerId: "owner-1" })).toBe(
      "?includeInactive=true&ownerId=owner-1",
    );
    expect(typesQuery({ includeInactive: false, ownerId: "owner-1" })).toBe("?ownerId=owner-1");
  });
});

describe("empties balances query string", () => {
  it("omits includeInactive when false and sends it when true", () => {
    expect(balancesQuery({})).toBe("");
    expect(balancesQuery({ includeInactive: true })).toBe("?includeInactive=true");
  });
});

describe("empties movements query string", () => {
  it("sends only the default limit when nothing else is set", () => {
    expect(movementsQuery({})).toBe("?limit=50");
  });

  it("builds from, to, typeId, ownerId, cursor and limit in order", () => {
    expect(
      movementsQuery({
        from: "2026-10-01",
        to: "2026-10-02",
        typeId: "type-1",
        ownerId: "owner-1",
        cursor: "abc",
        limit: 200,
      }),
    ).toBe(
      "?from=2026-10-01&to=2026-10-02&typeId=type-1&ownerId=owner-1&cursor=abc&limit=200",
    );
  });

  it("ignores a null cursor and empty strings", () => {
    expect(movementsQuery({ from: "", to: "", cursor: null })).toBe("?limit=50");
  });
});
