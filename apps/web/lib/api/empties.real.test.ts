import { describe, expect, it, vi } from "vitest";
import {
  customerBalancesQuery,
  customerMovementsQuery,
  emptiesRealApi,
} from "./empties.real";
import { customersRealApi } from "./customers.real";
import {
  balancesQuery,
  movementsQuery,
  ownersQuery,
  productOwnersQuery,
  typesQuery,
} from "./empties.real";

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

describe("empties product-owner query string", () => {
  it("omits unset filters and the all-assigned default", () => {
    expect(productOwnersQuery({})).toBe("");
    expect(productOwnersQuery({ assigned: "all" })).toBe("");
  });

  it("sends search, assignment filter, cursor and plain integer limit in order", () => {
    expect(
      productOwnersQuery({
        q: "  lager  ",
        assigned: "unassigned",
        cursor: "product-2",
        limit: 50,
      }),
    ).toBe("?q=lager&assigned=unassigned&cursor=product-2&limit=50");
  });
});

describe("customer-owned empties query strings", () => {
  it("encodes searchable balances and defaults to owing customers", () => {
    expect(customerBalancesQuery({ q: "  A&B  ", ownerId: "owner-1" })).toBe(
      "?ownerId=owner-1&q=A%26B&onlyOwing=true&limit=50",
    );
    expect(
      customerBalancesQuery({
        customerId: "customer-1",
        typeId: "type-1",
        onlyOwing: false,
        cursor: "next",
        limit: 25,
      }),
    ).toBe(
      "?customerId=customer-1&typeId=type-1&onlyOwing=false&cursor=next&limit=25",
    );
  });

  it("encodes movement date, customer, type, cursor and limit filters", () => {
    expect(
      customerMovementsQuery({
        from: "2026-10-01",
        to: "2026-10-31",
        customerId: "customer-1",
        typeId: "type-1",
        cursor: "next",
        limit: 25,
      }),
    ).toBe(
      "?from=2026-10-01&to=2026-10-31&customerId=customer-1&typeId=type-1&cursor=next&limit=25",
    );
  });

  it("uses the cursor-paged active customer API for the customer picker", async () => {
    const previousBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://api.test";
    const fetchMock = vi.fn().mockImplementation(
      async () => new Response(JSON.stringify({ items: [], nextCursor: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await emptiesRealApi.listCustomerBalances({ q: "phone search", limit: 50 });
      await customersRealApi.listPage({
        search: "  phone search  ",
        includeDeleted: false,
        limit: 25,
        cursor: "customer-next",
      });
      const requestedUrls = fetchMock.mock.calls.map(([url]) => String(url));
      expect(requestedUrls[0]).toBe(
        "http://api.test/empties/customer-balances?q=phone+search&onlyOwing=true&limit=50",
      );
      expect(requestedUrls[1]).toBe(
        "http://api.test/customers?q=phone+search&active=true&limit=25&cursor=customer-next",
      );
    } finally {
      vi.unstubAllGlobals();
      if (previousBaseUrl === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
      else process.env.NEXT_PUBLIC_API_BASE_URL = previousBaseUrl;
    }
  });
});
