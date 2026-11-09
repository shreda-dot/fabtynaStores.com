// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { buildAccountLedgerEntry, getLagosBusinessDate } from "@fabtyna/shared";
import { accountingMockApi } from "./accounting.mock";
import { familySupportMockApi } from "./family-support.mock";
import { resetDemoData, readMockStore, transactMockStore } from "./mock-store";

describe("mock family support", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetDemoData();
  });

  it("posts once, reports and reverses a drawing without changing expenses", async () => {
    const member = await familySupportMockApi.createMember({ name: "Dad", relationship: "Father" }, "member-key-1");
    const cash = (await accountingMockApi.listAccounts()).find((account) => account.type === "CASH")!;
    const occurredAt = new Date().toISOString();
    await accountingMockApi.recordOpeningBalance({ accountId: cash.id, amountKobo: "10000", note: null, occurredAt });
    const input = { beneficiaryId: member.id, purpose: "MEDICAL" as const, accountId: cash.id, amountKobo: "6000", occurredAt, note: null };
    const beforeExpenses = readMockStore().expenses.length;
    const drawing = await familySupportMockApi.createDrawing(input, "drawing-key-1");
    expect(await familySupportMockApi.createDrawing(input, "drawing-key-1")).toEqual(drawing);
    await expect(familySupportMockApi.createDrawing({ ...input, amountKobo: "5000" }, "drawing-key-1")).rejects.toThrow(/different request/);
    await expect(familySupportMockApi.createDrawing({ ...input, amountKobo: "5000" }, "drawing-key-2")).rejects.toThrow(/balance/);
    const today = getLagosBusinessDate();
    const report = await familySupportMockApi.listDrawings({ from: today, to: today });
    expect(report.report.totalKobo).toBe("6000");
    expect(readMockStore().expenses).toHaveLength(beforeExpenses);
    expect((await accountingMockApi.position()).ownerWithdrawals.drawingsKobo).toBe(6000n);
    const flow = await accountingMockApi.moneyFlow(today, today, cash.id);
    expect(flow.rows[0].categories).toContainEqual({ key: "OWNER_DRAWING", moneyInKobo: "0", moneyOutKobo: "6000" });
    const statement = await accountingMockApi.statementPage!(cash.id);
    expect(statement.entries.find((row) => row.type === "OWNER_DRAWING")?.sourceDescription).toBe("Owner drawing");
    const item = report.items[0];
    await familySupportMockApi.reverseDrawing(item.id, "Correction", "reverse-key-1");
    expect((await familySupportMockApi.listDrawings({ from: today, to: today })).report.totalKobo).toBe("0");
    expect((await accountingMockApi.listAccounts()).find((account) => account.id === cash.id)?.balanceKobo).toBe("10000");
    expect((await accountingMockApi.position()).ownerWithdrawals.drawingsKobo).toBe(0n);
  });

  it("supports bank drawings and managed beneficiaries without allowing inactive members", async () => {
    const member = await familySupportMockApi.createMember({ name: "Test", relationship: "Family" }, "member-key-2");
    const bank = (await accountingMockApi.listAccounts()).find((account) => account.type === "BANK")!;
    const occurredAt = new Date().toISOString();
    await accountingMockApi.recordOpeningBalance({ accountId: bank.id, amountKobo: "1000", note: null, occurredAt });
    await familySupportMockApi.updateMember(member.id, { name: "Renamed", relationship: "Sibling" }, "rename-key-2");
    await familySupportMockApi.setMemberActive(member.id, false, "deactivate-key-2");
    const input = { beneficiaryId: member.id, purpose: "SCHOOL_FEES" as const, accountId: bank.id, amountKobo: "500", occurredAt, note: null };
    await expect(familySupportMockApi.createDrawing(input, "drawing-key-3")).rejects.toThrow(/active beneficiary/);
    await familySupportMockApi.setMemberActive(member.id, true, "reactivate-key-2");
    await familySupportMockApi.createDrawing(input, "drawing-key-3");
    const today = getLagosBusinessDate();
    const report = await familySupportMockApi.listDrawings({ from: today, to: today, accountId: bank.id });
    expect(report.report.byBeneficiary[0]).toMatchObject({ name: "Renamed", amountKobo: "500" });
    expect(report.report.byAccount[0]).toMatchObject({ id: bank.id, amountKobo: "500" });
    expect((await accountingMockApi.listAccounts()).find((account) => account.id === bank.id)?.balanceKobo).toBe("500");
  });

  it("reports a source-linked drawing on its expense date without changing its ledger posting date", async () => {
    const member = await familySupportMockApi.createMember({ name: "Original date", relationship: "Family" });
    const bank = (await accountingMockApi.listAccounts()).find((account) => account.type === "BANK")!;
    const postedAt = new Date();
    await accountingMockApi.recordOpeningBalance({ accountId: bank.id, amountKobo: "10000", note: null, occurredAt: postedAt.toISOString() });
    const expenseDate = new Date("2020-10-30T23:30:00.000Z");
    transactMockStore((store) => {
      store.expenses.push({
        id: "history-expense", channel: "BOTH", category: "OTHER", description: "Test",
        amountKobo: 10000n, expenseDate, loanRepaymentId: null,
        voidedAt: postedAt, voidReason: "Test classification", createdAt: postedAt, updatedAt: postedAt,
      });
      const entry = buildAccountLedgerEntry({
        accountId: bank.id, type: "OWNER_DRAWING", amountKobo: -10000n,
        occurredAt: postedAt, note: "Test classification",
      }, () => "history-entry");
      store.accountLedgerEntries.push(entry);
      store.drawings.push({ id: "history-drawing", entryId: entry.id, beneficiaryId: member.id, purpose: "MEDICAL", sourceExpenseId: "history-expense" });
    });
    const history = await familySupportMockApi.listDrawings({ from: "2020-10-31", to: "2020-10-31", accountId: bank.id });
    expect(history.report).toMatchObject({ count: 1, totalKobo: "10000" });
    expect(history.items[0]).toMatchObject({ occurredAt: expenseDate.toISOString(), postedAt: postedAt.toISOString() });
    const today = getLagosBusinessDate(postedAt);
    expect((await familySupportMockApi.listDrawings({ from: today, to: today, accountId: bank.id })).report.count).toBe(0);
    const flow = await accountingMockApi.moneyFlow(today, today, bank.id);
    expect(flow.rows[0].categories).toContainEqual({ key: "OWNER_DRAWING", moneyInKobo: "0", moneyOutKobo: "10000" });
  });
});
