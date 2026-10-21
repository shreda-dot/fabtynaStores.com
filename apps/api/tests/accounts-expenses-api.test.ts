import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getLagosBusinessDate } from "@fabtyna/shared";
import { buildApp } from "../src/app.js";
import {
  accountBalanceOf,
  createHarness,
  newId,
  type Harness,
} from "./sales-fixtures.js";

let h!: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

describe("expense categories and accounts API", () => {
  it("defaults sales and purchases to today and enforces the configured range cap", async () => {
    const today = getLagosBusinessDate(new Date());
    for (const resource of ["sales", "purchases"]) {
      const defaultRange = await h.app.inject({ method: "GET", url: `/${resource}` });
      expect(defaultRange.statusCode).toBe(200);
      expect(defaultRange.json<{ from: string; to: string }>()).toMatchObject({
        from: today,
        to: today,
      });

      const tooWide = await h.app.inject({
        method: "GET",
        url: `/${resource}?from=2024-01-01&to=2025-01-01`,
      });
      expect(tooWide.statusCode).toBe(400);
    }

    const cappedApp = buildApp({
      prisma: h.prisma,
      auth: {
        nodeEnv: "test",
        webOrigin: "http://localhost:3000",
        cookieDomain: null,
        sessionIdleTimeoutHours: 12,
        sessionAbsoluteTimeoutDays: 7,
      },
      trustProxy: false,
      maxDateRangeDays: 30,
    });
    try {
      const customCap = await cappedApp.inject({
        method: "GET",
        url: "/sales?from=2026-01-01&to=2026-01-31",
        headers: h.authHeaders,
      });
      expect(customCap.statusCode).toBe(400);
      expect(customCap.json<{ error: { message: string } }>().error.message).toContain("30 days");
    } finally {
      await cappedApp.close();
    }
  });

  it("creates, renames, deactivates, and reactivates a user expense category", async () => {
    const key = newId("category-key");
    const created = await h.app.inject({
      method: "POST",
      url: "/expense-categories",
      headers: { "idempotency-key": key },
      payload: { name: `Office ${newId("cat")}` },
    });
    expect(created.statusCode).toBe(201);
    const category = created.json<{ id: string; name: string }>();

    const replay = await h.app.inject({
      method: "POST",
      url: "/expense-categories",
      headers: { "idempotency-key": key },
      payload: { name: category.name },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.json<{ id: string }>().id).toBe(category.id);

    const renamed = await h.app.inject({
      method: "PATCH",
      url: `/expense-categories/${category.id}`,
      payload: { name: `${category.name} and supplies` },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json<{ name: string }>().name).toBe(`${category.name} and supplies`);

    const deactivated = await h.app.inject({
      method: "POST",
      url: `/expense-categories/${category.id}/deactivate`,
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deactivated.json<{ isActive: boolean }>().isActive).toBe(false);

    const activeList = await h.app.inject({ method: "GET", url: "/expense-categories" });
    expect(activeList.json<Array<{ id: string }>>().some((row) => row.id === category.id)).toBe(false);
    const allList = await h.app.inject({ method: "GET", url: "/expense-categories?includeInactive=true" });
    expect(allList.json<Array<{ id: string }>>().some((row) => row.id === category.id)).toBe(true);

    const reactivated = await h.app.inject({
      method: "POST",
      url: `/expense-categories/${category.id}/reactivate`,
    });
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json<{ isActive: boolean }>().isActive).toBe(true);
  });

  it("records opening balances, movements, reconciliations, transfers, and paginated statements", async () => {
    const accountKey = newId("account-key");
    const created = await h.app.inject({
      method: "POST",
      url: "/accounts",
      headers: { "idempotency-key": accountKey },
      payload: { name: `Cash ${newId("account")}`, type: "CASH" },
    });
    expect(created.statusCode).toBe(201);
    const account = created.json<{ id: string; name: string }>();

    const replay = await h.app.inject({
      method: "POST",
      url: "/accounts",
      headers: { "idempotency-key": accountKey },
      payload: { name: account.name, type: "CASH" },
    });
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(replay.json<{ id: string }>().id).toBe(account.id);

    const opening = await h.app.inject({
      method: "POST",
      url: `/accounts/${account.id}/opening-balance`,
      payload: { amountKobo: "50000", note: "Counted on setup" },
    });
    expect(opening.statusCode).toBe(201);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(50_000n);

    const reconcile = await h.app.inject({
      method: "POST",
      url: `/accounts/${account.id}/reconcile`,
      payload: { countedAmountKobo: "53000", reason: "Till count" },
    });
    expect(reconcile.statusCode).toBe(201);
    expect(reconcile.json<{ type: string; amountKobo: string }>().type).toBe("ADJUSTMENT");
    expect(reconcile.json<{ amountKobo: string }>().amountKobo).toBe("3000");

    const overspend = await h.app.inject({
      method: "POST",
      url: `/accounts/${account.id}/movements`,
      payload: { type: "OWNER_DRAWING", amountKobo: "53001", note: "Owner withdrawal" },
    });
    expect(overspend.statusCode).toBe(409);
    expect(overspend.json<{ error: { message: string } }>().error.message).toContain(account.name);
    expect(overspend.json<{ error: { message: string } }>().error.message).toContain("record income or reconcile first");
    expect(await accountBalanceOf(h.pg, account.id)).toBe(53_000n);

    const destination = await h.app.inject({
      method: "POST",
      url: "/accounts",
      payload: { name: `Bank ${newId("account")}`, type: "BANK" },
    });
    expect(destination.statusCode).toBe(201);
    const destinationAccount = destination.json<{ id: string }>();
    const transfer = await h.app.inject({
      method: "POST",
      url: "/account-transfers",
      payload: {
        fromAccountId: account.id,
        toAccountId: destinationAccount.id,
        amountKobo: "5000",
        note: "Deposit",
      },
    });
    expect(transfer.statusCode).toBe(201);
    const transferId = transfer.json<{ id: string }>().id;
    expect(await accountBalanceOf(h.pg, account.id)).toBe(48_000n);
    expect(await accountBalanceOf(h.pg, destinationAccount.id)).toBe(5_000n);

    const reversed = await h.app.inject({
      method: "POST",
      url: `/account-transfers/${transferId}/reverse`,
      payload: { reason: "Entered in error" },
    });
    expect(reversed.statusCode).toBe(201);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(53_000n);
    expect(await accountBalanceOf(h.pg, destinationAccount.id)).toBe(0n);

    const statement = await h.app.inject({
      method: "GET",
      url: `/accounts/${account.id}/statement?limit=1`,
    });
    expect(statement.statusCode).toBe(200);
    const firstPage = statement.json<{
      from: string;
      to: string;
      entries: Array<{ id: string }>;
      nextCursor: string | null;
    }>();
    const today = getLagosBusinessDate(new Date());
    expect(firstPage).toMatchObject({ from: today, to: today });
    expect(firstPage.entries).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = await h.app.inject({
      method: "GET",
      url: `/accounts/${account.id}/statement?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
    });
    const secondEntry = secondPage.json<{ entries: Array<{ id: string }> }>().entries[0];
    expect(secondEntry).toBeDefined();
    expect(secondEntry?.id).not.toBe(firstPage.entries[0]?.id);
    const tooWideStatement = await h.app.inject({
      method: "GET",
      url: `/accounts/${account.id}/statement?from=2024-01-01&to=2025-01-01`,
    });
    expect(tooWideStatement.statusCode).toBe(400);

    const draw = await h.app.inject({
      method: "POST",
      url: `/accounts/${account.id}/movements`,
      payload: { type: "OWNER_DRAWING", amountKobo: "53000", note: "Close account" },
    });
    expect(draw.statusCode).toBe(201);
    const deactivated = await h.app.inject({
      method: "POST",
      url: `/accounts/${account.id}/deactivate`,
    });
    expect(deactivated.statusCode).toBe(200);
    const reactivated = await h.app.inject({
      method: "POST",
      url: `/accounts/${account.id}/reactivate`,
    });
    expect(reactivated.statusCode).toBe(200);
  }, 90_000);
});

describe("expenses API", () => {
  it("creates, lists, summarizes, voids, and amends expenses without editing history", async () => {
    const categoryResponse = await h.app.inject({ method: "GET", url: "/expense-categories" });
    const category = categoryResponse
      .json<Array<{ id: string; code: string }>>()
      .find((row) => row.code === "OTHER");
    expect(category).toBeDefined();

    const accountResponse = await h.app.inject({
      method: "POST",
      url: "/accounts",
      payload: { name: `Expense cash ${newId("account")}`, type: "CASH" },
    });
    const account = accountResponse.json<{ id: string; name: string }>();
    const opening = await h.app.inject({
      method: "POST",
      url: `/accounts/${account.id}/opening-balance`,
      payload: { amountKobo: "100000" },
    });
    expect(opening.statusCode).toBe(201);

    const expenseDate = new Date().toISOString();
    const body = {
      categoryId: category!.id,
      channel: "BOTH",
      description: "Monthly shop supplies",
      amountKobo: "90001",
      expenseDate,
      accountId: account.id,
    };
    const created = await h.app.inject({ method: "POST", url: "/expenses", payload: body });
    expect(created.statusCode).toBe(201);
    const expense = created.json<{ id: string; amountKobo: string }>();
    expect(expense.amountKobo).toBe("90001");
    expect(await accountBalanceOf(h.pg, account.id)).toBe(9_999n);

    const insufficient = await h.app.inject({
      method: "POST",
      url: "/expenses",
      payload: { ...body, amountKobo: "1000000" },
    });
    expect(insufficient.statusCode).toBe(409);
    expect(insufficient.json<{ error: { message: string } }>().error.message).toContain(account.name);

    const retailSummary = await h.app.inject({
      method: "GET",
      url: `/expenses/summary?channel=RETAIL&accountId=${account.id}`,
    });
    expect(retailSummary.statusCode).toBe(200);
    expect(retailSummary.json<{ from: string; to: string; totalKobo: string }>().totalKobo).toBe("45000");
    const today = getLagosBusinessDate(new Date());
    expect(retailSummary.json<{ from: string; to: string }>()).toMatchObject({ from: today, to: today });

    const voided = await h.app.inject({
      method: "POST",
      url: `/expenses/${expense.id}/void`,
      payload: { reason: "Wrong category" },
    });
    expect(voided.statusCode).toBe(200);
    expect(await accountBalanceOf(h.pg, account.id)).toBe(100_000n);

    const activeList = await h.app.inject({ method: "GET", url: "/expenses" });
    expect(activeList.json<{ items: Array<{ id: string }> }>().items.some((item) => item.id === expense.id)).toBe(false);
    const allList = await h.app.inject({ method: "GET", url: "/expenses?includeVoided=true" });
    expect(allList.json<{ items: Array<{ id: string; voided: boolean }> }>().items).toContainEqual(
      expect.objectContaining({ id: expense.id, voided: true }),
    );

    const amendSourceResponse = await h.app.inject({
      method: "POST",
      url: "/expenses",
      payload: { ...body, description: "Original supplies before amendment" },
    });
    expect(amendSourceResponse.statusCode).toBe(201);
    const amendSource = amendSourceResponse.json<{ id: string }>();
    const amended = await h.app.inject({
      method: "PUT",
      url: `/expenses/${amendSource.id}`,
      payload: { ...body, amountKobo: "30000", description: "Corrected supplies" },
    });
    expect(amended.statusCode, amended.body).toBe(200);
    const replacement = amended.json<{ expense: { id: string; amountKobo: string } }>().expense;
    expect(replacement.id).not.toBe(amendSource.id);
    expect(replacement.amountKobo).toBe("30000");
    expect(await accountBalanceOf(h.pg, account.id)).toBe(70_000n);

    const tooWide = await h.app.inject({
      method: "GET",
      url: "/expenses?from=2024-01-01&to=2025-01-01",
    });
    expect(tooWide.statusCode).toBe(400);
  });
});
