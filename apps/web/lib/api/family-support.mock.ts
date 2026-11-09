import {
  accountBalanceKobo,
  assertAccountWillRemainNonnegative,
  assertNotFutureOccurredAt,
  buildAccountLedgerEntry,
  createDrawingSchema,
  drawingReport,
  familyMemberInputSchema,
  fromAuditLogDto,
  getLagosBusinessDate,
  toAuditLogDto,
} from "@fabtyna/shared";
import type { FamilySupportApi, DrawingTotal } from "./family-support.api";
import { newId, readMockStore, transactMockStore, type MockStore } from "./mock-store";
import { mockDelay } from "./mock-transport";
import { ApiError } from "./client";
import { ZodError } from "zod";

class MockFamilyError extends Error {}

async function expectedErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof MockFamilyError || error instanceof RangeError || error instanceof ZodError) {
      throw new ApiError("validation", error instanceof ZodError ? "Check the Family Support details and try again." : error.message, { cause: error, status: 409 });
    }
    throw error;
  }
}

function total(row: { id: string; name: string; amountKobo: bigint; count: number }): DrawingTotal {
  return { ...row, amountKobo: row.amountKobo.toString() };
}
function audit(store: MockStore, action: string, entityType: string, entityId: string, beforeData: unknown, afterData: unknown) {
  store.auditLogs.push(fromAuditLogDto(toAuditLogDto({
    id: newId(), actorId: null, action, entityType, entityId,
    beforeData, afterData, metadata: null, occurredAt: new Date(),
  })));
}
function write<T>(store: MockStore, route: string, key: string | undefined, body: unknown, action: () => T): T {
  if (key === undefined) return action();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new MockFamilyError("Invalid idempotency key.");
  const id = `${route}:${key}`;
  const fingerprint = JSON.stringify(body);
  const existing = store.familySupportWrites.find((row) => row.id === id);
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw new MockFamilyError("This idempotency key was already used for a different request.");
    return existing.result as T;
  }
  const result = action();
  store.familySupportWrites.push({ id, fingerprint, result });
  return result;
}

const implementation: FamilySupportApi = {
  async listMembers() {
    await mockDelay();
    return readMockStore().familyMembers.sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name));
  },
  async createMember(input, key) {
    await mockDelay();
    const data = familyMemberInputSchema.parse(input);
    return transactMockStore((store) => write(store, "create-member", key, data, () => {
      if (store.familyMembers.some((member) => member.name.toLowerCase() === data.name.toLowerCase())) {
        throw new MockFamilyError("A beneficiary with this name already exists.");
      }
      const member = { id: newId(), ...data, isActive: true };
      store.familyMembers.push(member);
      audit(store, "FAMILY_MEMBER_CREATED", "FamilyMember", member.id, null, member);
      return member;
    }));
  },
  async updateMember(id, input, key) {
    await mockDelay();
    const data = familyMemberInputSchema.parse(input);
    return transactMockStore((store) => write(store, `update-member:${id}`, key, data, () => {
      const member = store.familyMembers.find((item) => item.id === id);
      if (!member) throw new MockFamilyError("Beneficiary not found.");
      if (store.familyMembers.some((item) => item.id !== id && item.name.toLowerCase() === data.name.toLowerCase())) {
        throw new MockFamilyError("A beneficiary with this name already exists.");
      }
      const before = { ...member };
      Object.assign(member, data);
      audit(store, "FAMILY_MEMBER_UPDATED", "FamilyMember", id, before, member);
      return member;
    }));
  },
  async setMemberActive(id, active, key) {
    await mockDelay();
    return transactMockStore((store) => write(store, `member-active:${id}:${active}`, key, { active }, () => {
      const member = store.familyMembers.find((item) => item.id === id);
      if (!member) throw new MockFamilyError("Beneficiary not found.");
      if (member.isActive === active) throw new MockFamilyError("Beneficiary is already in that state.");
      const before = { ...member };
      member.isActive = active;
      audit(store, active ? "FAMILY_MEMBER_REACTIVATED" : "FAMILY_MEMBER_DEACTIVATED", "FamilyMember", id, before, member);
      return member;
    }));
  },
  async createDrawing(input, key) {
    await mockDelay();
    const data = createDrawingSchema.parse(input);
    const occurredAt = new Date(data.occurredAt);
    assertNotFutureOccurredAt(occurredAt, getLagosBusinessDate());
    return transactMockStore((store) => write(store, "create-drawing", key, data, () => {
      const member = store.familyMembers.find((item) => item.id === data.beneficiaryId);
      if (!member?.isActive) throw new MockFamilyError("Select an active beneficiary.");
      const account = store.accounts.find((item) => item.id === data.accountId);
      if (!account || !account.isActive || (account.type !== "CASH" && account.type !== "BANK")) {
        throw new MockFamilyError("Select an active cash or bank account.");
      }
      const amount = BigInt(data.amountKobo);
      assertAccountWillRemainNonnegative(account, accountBalanceKobo(account.id, store.accountLedgerEntries), -amount);
      const entry = buildAccountLedgerEntry({
        accountId: account.id, type: "OWNER_DRAWING", amountKobo: -amount,
        note: data.note || `Owner drawing: ${data.purpose.replaceAll("_", " ")}`, occurredAt,
      }, newId);
      const drawing = { id: newId(), entryId: entry.id, beneficiaryId: member.id, purpose: data.purpose, sourceExpenseId: null };
      store.accountLedgerEntries.push(entry);
      store.drawings.push(drawing);
      audit(store, "DRAWING_RECORDED", "Drawing", drawing.id, null, { ...drawing, amountKobo: data.amountKobo, accountId: account.id });
      return drawing;
    }));
  },
  async reverseDrawing(id, reason, key) {
    await mockDelay();
    if (!reason.trim() || reason.trim().length > 500) throw new MockFamilyError("Enter a reason of at most 500 characters.");
    return transactMockStore((store) => write(store, `reverse-drawing:${id}`, key, { reason }, () => {
      const drawing = store.drawings.find((item) => item.id === id);
      const entry = store.accountLedgerEntries.find((item) => item.id === drawing?.entryId);
      if (!entry) throw new MockFamilyError("Drawing not found.");
      if (store.accountLedgerEntries.some((item) => item.reversesEntryId === entry.id)) throw new MockFamilyError("Drawing is already reversed.");
      const reversal = { ...entry, id: newId(), amountKobo: -entry.amountKobo, reversesEntryId: entry.id, note: reason.trim(), occurredAt: new Date() };
      store.accountLedgerEntries.push(reversal);
      audit(store, "ACCOUNT_ENTRY_REVERSED", "AccountLedgerEntry", entry.id, null, {
        targetId: entry.id, reversalId: reversal.id, reason: reason.trim(),
      });
      return reversal.id;
    }));
  },
  async listDrawings(filter) {
    await mockDelay();
    const store = readMockStore();
    const rows = store.drawings.map((drawing) => {
      const entry = store.accountLedgerEntries.find((item) => item.id === drawing.entryId);
      const member = store.familyMembers.find((item) => item.id === drawing.beneficiaryId);
      const account = store.accounts.find((item) => item.id === entry?.accountId);
      if (!entry || !member || !account) throw new Error("Drawing data is incomplete.");
      const sourceExpense = drawing.sourceExpenseId === null
        ? null : store.expenses.find((item) => item.id === drawing.sourceExpenseId);
      if (drawing.sourceExpenseId !== null && !sourceExpense) throw new Error("Drawing source expense is missing.");
      return {
        ...drawing, beneficiaryName: member.name, accountId: account.id, accountName: account.name,
        amountKobo: -entry.amountKobo, occurredAt: sourceExpense?.expenseDate ?? entry.occurredAt,
        postedAt: entry.occurredAt, note: entry.note,
        reversed: store.accountLedgerEntries.some((item) => item.reversesEntryId === entry.id),
      };

    });
    const report = drawingReport(rows, filter);
    const items = rows.filter((row) => {
      const date = getLagosBusinessDate(row.occurredAt);
      return date >= filter.from && date <= filter.to &&
        (!filter.beneficiaryId || row.beneficiaryId === filter.beneficiaryId) &&
        (!filter.purpose || row.purpose === filter.purpose) &&
        (!filter.accountId || row.accountId === filter.accountId);
    }).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id.localeCompare(a.id));
    return {
      items: items.map((row) => ({
        ...row, amountKobo: row.amountKobo.toString(),
        occurredAt: row.occurredAt.toISOString(), postedAt: row.postedAt.toISOString(),
      })),
      report: {
        count: report.count, totalKobo: report.totalKobo.toString(),
        byBeneficiary: report.byBeneficiary.map((row) => ({ ...total(row), byPurpose: row.byPurpose.map(total) })),
        byPurpose: report.byPurpose.map(total), byAccount: report.byAccount.map(total),
      },
    };
  },
};

export const familySupportMockApi: FamilySupportApi = {
  listMembers: implementation.listMembers,
  listDrawings: implementation.listDrawings,
  createMember: (input, key) => expectedErrors(() => implementation.createMember(input, key)),
  updateMember: (id, input, key) => expectedErrors(() => implementation.updateMember(id, input, key)),
  setMemberActive: (id, active, key) => expectedErrors(() => implementation.setMemberActive(id, active, key)),
  createDrawing: (input, key) => expectedErrors(() => implementation.createDrawing(input, key)),
  reverseDrawing: (id, reason, key) => expectedErrors(() => implementation.reverseDrawing(id, reason, key)),
};
