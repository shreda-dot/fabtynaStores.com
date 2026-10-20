import {
  accountBalanceKobo,
  accountBalancesKobo,
  accountMoneyFlowReport,
  ACCOUNT_MIGRATION_RECONCILIATION_NOTICE_ID,
  assertAccountAcceptsNewEntries,
  assertAccountDeactivatable,
  assertAccountWillRemainNonnegative,
  assertNotFutureOccurredAt,
  buildAccountLedgerEntry,
  buildAccountTransfer,
  buildOpeningBalanceEntry,
  buildReconcileAdjustment,
  computeFinancialPosition,
  createAccountDtoSchema,
  createAccountTransferDtoSchema,
  createOpeningBalanceDtoSchema,
  deactivateAccountDtoSchema,
  getLagosBusinessDate,
  getLagosBusinessDayRange,
  loanOutstandingKobo,
  reconcileAccountDtoSchema,
  purchaseBalanceKobo,
  stockByProductAndLocation,
  toAccountDto,
  toAccountLedgerEntryDto,
  toAccountTransferDto,
  toAuditLogDto,
  fromAuditLogDto,
  updateAccountDtoSchema,
  validateAccount,
  type Account,
  type AccountEntryType,
  type FinancialObligation,
  type FinancialPositionProductInput,
} from "@fabtyna/shared";
import type { AccountingApi } from "./accounting.api";
import { newId, readMockStore, transactMockStore } from "./mock-store";
import { mockDelay } from "./mock-transport";

function delay(): Promise<void> {
  return mockDelay();
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function findAccount(accounts: readonly Account[], id: string): Account {
  const account = accounts.find((candidate) => candidate.id === id);
  if (!account) throw new Error("Account not found.");
  return account;
}

function audit(
  draft: ReturnType<typeof readMockStore>,
  action: string,
  entityId: string,
  beforeData: unknown,
  afterData: unknown,
): void {
  draft.auditLogs.push(
    fromAuditLogDto(
      toAuditLogDto({
        id: newId(),
        actorId: null,
        action,
        entityType: "Account",
        entityId,
        beforeData,
        afterData,
        metadata: null,
        occurredAt: new Date(),
      }),
    ),
  );
}

function validateOccurredAt(value: string): Date {
  const occurredAt = new Date(value);
  assertNotFutureOccurredAt(occurredAt, getLagosBusinessDate());
  return occurredAt;
}

export const accountingMockApi: AccountingApi = {
  async position(options) {
    await delay();
    const store = readMockStore();
    const today = getLagosBusinessDate();

    const byProductLocation = stockByProductAndLocation(store.stockMovements);

    // Include inactive products that still hold stock; ignore zero/negative
    // quantities (the domain also guards this, but we avoid the noise here).
    const products: FinancialPositionProductInput[] = [];
    for (const product of store.products) {
      const byLocation = byProductLocation.get(product.id) ?? new Map();
      const warehouseUnits = byLocation.get("WAREHOUSE") ?? 0;
      const fridgeUnits =
        (byLocation.get("RETAIL_SHELF") ?? 0) + (byLocation.get("MARKET") ?? 0);
      if (warehouseUnits <= 0 && fridgeUnits <= 0) continue;

      const packSize = product.unitsPerPack > 0 ? product.unitsPerPack : 1;
      const warehousePacks = Math.floor(warehouseUnits / packSize);
      const warehouseLooseUnits = warehouseUnits - warehousePacks * packSize;

      products.push({
        productId: product.id,
        productName: product.name,
        warehousePacks,
        warehouseLooseUnits,
        fridgeUnits,
        packSizeUnits: packSize,
        retailPriceKobo: product.retailPriceKobo,
        wholesalePriceKobo: product.wholesalePriceKobo,
        averageCostKobo: product.averageCostKobo,
      });
    }

    // Receivables: every non-voided sale that still owes money, all dates.
    let receivablesKobo = 0n;
    for (const sale of store.sales) {
      if (sale.status === "VOIDED") continue;
      const owed = sale.totalKobo - sale.paidKobo;
      if (owed > 0n) receivablesKobo += owed;
    }

    const cashKobo = Array.from(
      accountBalancesKobo(store.accounts, store.accountLedgerEntries).values(),
    ).reduce((balance, accountBalance) => balance + accountBalance, 0n);

    // Supplier payables, with a per-supplier breakdown for the position page.
    const payablesBySupplierMap = new Map<string, bigint>();
    const obligations: Omit<FinancialObligation, "urgency">[] = [];
    let supplierPayablesKobo = 0n;
    for (const purchase of store.purchases) {
      if (purchase.status === "VOIDED" || purchase.supplierId === null) continue;
      const balance = purchaseBalanceKobo(purchase);
      if (balance <= 0n) continue;
      supplierPayablesKobo += balance;
      payablesBySupplierMap.set(
        purchase.supplierId,
        (payablesBySupplierMap.get(purchase.supplierId) ?? 0n) + balance,
      );
      const supplier = store.suppliers.find((s) => s.id === purchase.supplierId);
      obligations.push({
        kind: "SUPPLIER_PURCHASE",
        id: purchase.id,
        label: `${supplier?.name ?? "Supplier"} — ${purchase.reference ?? purchase.id.slice(0, 8)}`,
        balanceKobo: balance,
        dueDate: purchase.dueDate,
      });
    }

    const payablesBySupplier = Array.from(payablesBySupplierMap.entries()).map(
      ([supplierId, amountKobo]) => ({
        supplierId,
        supplierName:
          store.suppliers.find((s) => s.id === supplierId)?.name ?? "Unknown supplier",
        amountKobo,
      }),
    );

    // Loans, with a per-lender breakdown and per-loan obligations.
    const loansByLender: { loanId: string; lenderName: string; amountKobo: bigint }[] = [];
    let loansOutstandingKobo = 0n;
    for (const loan of store.loans) {
      const outstanding = loanOutstandingKobo(loan.id, store.loanLedgerEntries);
      if (outstanding <= 0n) continue;
      loansOutstandingKobo += outstanding;
      loansByLender.push({
        loanId: loan.id,
        lenderName: loan.lenderName,
        amountKobo: outstanding,
      });
      obligations.push({
        kind: "LOAN",
        id: loan.id,
        label: `${loan.lenderName} loan`,
        balanceKobo: outstanding,
        dueDate: loan.dueDate,
      });
    }

    const result = computeFinancialPosition({
      todayLagosDate: today,
      products,
      receivablesKobo,
      cashKobo,
      supplierPayablesKobo,
      loansOutstandingKobo,
      options,
      liabilitiesBreakdown: { payablesBySupplier, loansByLender },
      obligations,
    });

    return result;
  },

  async moneyFlow(from, to, accountId) {
    await delay();
    if (from > to) {
      throw new RangeError("From date must be on or before to date.");
    }
    const start = getLagosBusinessDayRange(from).start;
    const end = getLagosBusinessDayRange(to).end;
    const store = readMockStore();
    const report = accountMoneyFlowReport(
      store.accounts,
      store.accountLedgerEntries,
      store.expenses,
      store.sales,
      start,
      end,
      accountId,
    );
    return {
      rows: report.rows.map((row) => ({
        accountId: row.accountId,
        accountName: row.accountName,
        accountType: row.accountType,
        openingBalanceKobo: row.openingBalanceKobo.toString(),
        moneyInKobo: row.moneyInKobo.toString(),
        moneyOutKobo: row.moneyOutKobo.toString(),
        netKobo: row.netKobo.toString(),
        closingBalanceKobo: row.closingBalanceKobo.toString(),
        categories: row.categories.map((category) => ({
          key: category.key,
          moneyInKobo: category.moneyInKobo.toString(),
          moneyOutKobo: category.moneyOutKobo.toString(),
        })),
      })),
      totals: {
        openingBalanceKobo: report.totalOpeningBalanceKobo.toString(),
        moneyInKobo: report.totalMoneyInKobo.toString(),
        moneyOutKobo: report.totalMoneyOutKobo.toString(),
        netKobo: report.totalNetKobo.toString(),
        closingBalanceKobo: report.totalClosingBalanceKobo.toString(),
      },
      sales: {
        billedKobo: report.salesBilledKobo.toString(),
        customerMoneyReceivedKobo: report.customerMoneyReceivedKobo.toString(),
        debtOutstandingKobo: report.salesDebtOutstandingKobo.toString(),
      },
    };
  },

  async listAccounts() {
    await delay();
    const accounts = readMockStore().accounts
      .slice()
      .sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map(toAccountDto);
    return jsonClone(accounts);
  },

  async createAccount(input) {
    await delay();
    const data = createAccountDtoSchema.parse(input);
    const now = new Date();
    const account: Account = {
      id: newId(),
      name: data.name,
      type: data.type,
      isActive: true,
      deactivatedAt: null,
      note: data.note,
      createdAt: now,
      updatedAt: now,
    };
    validateAccount(account);
    transactMockStore((draft) => {
      draft.accounts.push(account);
      audit(draft, "ACCOUNT_CREATED", account.id, null, toAccountDto(account));
      return account;
    });
    return jsonClone(toAccountDto(account));
  },

  async updateAccount(id, input) {
    await delay();
    const data = updateAccountDtoSchema.parse(input);
    const result = transactMockStore((draft) => {
      const account = findAccount(draft.accounts, id);
      const before = toAccountDto(account);
      account.name = data.name;
      account.note = data.note;
      account.updatedAt = new Date();
      validateAccount(account);
      audit(draft, "ACCOUNT_UPDATED", id, before, toAccountDto(account));
      return account;
    });
    return jsonClone(toAccountDto(result));
  },

  async deactivateAccount(id, input) {
    await delay();
    const data = deactivateAccountDtoSchema.parse(input);
    const result = transactMockStore((draft) => {
      const account = findAccount(draft.accounts, id);
      const before = toAccountDto(account);
      assertAccountDeactivatable(
        account,
        accountBalanceKobo(account.id, draft.accountLedgerEntries),
      );
      if (!account.isActive) throw new RangeError("This account is already deactivated.");
      account.isActive = false;
      account.deactivatedAt = new Date();
      account.updatedAt = account.deactivatedAt;
      validateAccount(account);
      audit(draft, "ACCOUNT_DEACTIVATED", id, before, {
        ...toAccountDto(account),
        reason: data.reason,
      });
      return account;
    });
    return jsonClone(toAccountDto(result));
  },

  async recordOpeningBalance(input) {
    await delay();
    const data = createOpeningBalanceDtoSchema.parse(input);
    const occurredAt = validateOccurredAt(data.occurredAt);
    const result = transactMockStore((draft) => {
      const account = findAccount(draft.accounts, data.accountId);
      assertAccountAcceptsNewEntries(account, false);
      const entry = buildOpeningBalanceEntry(
        {
          accountId: account.id,
          amountKobo: BigInt(data.amountKobo),
          note: data.note,
          occurredAt,
        },
        draft.accountLedgerEntries,
        newId,
      );
      draft.accountLedgerEntries.push(entry);
      audit(draft, "ACCOUNT_OPENING_BALANCE_RECORDED", entry.id, null, toAccountLedgerEntryDto(entry));
      return entry;
    });
    return jsonClone(toAccountLedgerEntryDto(result));
  },

  async reconcileAccount(input) {
    await delay();
    const data = reconcileAccountDtoSchema.parse(input);
    const occurredAt = validateOccurredAt(data.occurredAt);
    const result = transactMockStore((draft) => {
      const account = findAccount(draft.accounts, data.accountId);
      assertAccountAcceptsNewEntries(account, false);
      const entry = buildReconcileAdjustment(
        {
          accountId: account.id,
          deltaKobo: BigInt(data.deltaKobo),
          note: data.note,
          occurredAt,
        },
        account,
        accountBalanceKobo(account.id, draft.accountLedgerEntries),
        newId,
      );
      draft.accountLedgerEntries.push(entry);
      audit(draft, "ACCOUNT_RECONCILED", entry.id, null, toAccountLedgerEntryDto(entry));
      return entry;
    });
    return jsonClone(toAccountLedgerEntryDto(result));
  },

  async recordTransfer(input) {
    await delay();
    const data = createAccountTransferDtoSchema.parse(input);
    const occurredAt = validateOccurredAt(data.occurredAt);
    transactMockStore((draft) => {
      const fromAccount = findAccount(draft.accounts, data.fromAccountId);
      const transfer = buildAccountTransfer(
        {
          fromAccountId: data.fromAccountId,
          toAccountId: data.toAccountId,
          amountKobo: BigInt(data.amountKobo),
          note: data.note,
          occurredAt,
        },
        draft.accounts,
        accountBalanceKobo(fromAccount.id, draft.accountLedgerEntries),
        newId,
      );
      draft.accountTransfers.push(transfer.transfer);
      draft.accountLedgerEntries.push(...transfer.entries);
      audit(
        draft,
        "ACCOUNT_TRANSFER_RECORDED",
        transfer.transfer.id,
        null,
        toAccountTransferDto(transfer.transfer),
      );
    });
  },

  async recordManualEntry(input) {
    await delay();
    const accountId = input.accountId.trim();
    const type = input.type as AccountEntryType;
    const amountKobo = input.amountKobo;
    if (!/^[0-9]+$/.test(amountKobo) || BigInt(amountKobo) <= 0n) {
      throw new RangeError("Enter an amount greater than zero.");
    }
    const note = input.note.trim();
    if (note === "") throw new RangeError("Enter a reason or description.");
    const occurredAt = validateOccurredAt(input.occurredAt);
    const positiveType = type === "OWNER_CAPITAL" || type === "OTHER_INCOME";
    const entry = transactMockStore((draft) => {
      const account = findAccount(draft.accounts, accountId);
      assertAccountAcceptsNewEntries(account, false);
      const signedAmount = BigInt(amountKobo) * (positiveType ? 1n : -1n);
      assertAccountWillRemainNonnegative(
        account,
        accountBalanceKobo(account.id, draft.accountLedgerEntries),
        signedAmount,
      );
      const created = buildAccountLedgerEntry(
        {
          accountId: account.id,
          type,
          amountKobo: signedAmount,
          otherIncomeId: null,
          note,
          occurredAt,
        },
        newId,
      );
      draft.accountLedgerEntries.push(created);
      audit(draft, `ACCOUNT_${type}_RECORDED`, created.id, null, toAccountLedgerEntryDto(created));
      return created;
    });
    return jsonClone(toAccountLedgerEntryDto(entry));
  },

  async listLedgerEntries(accountId, options) {
    await delay();
    const entries = readMockStore().accountLedgerEntries
      .filter((entry) => {
        if (entry.accountId !== accountId) return false;
        const date = getLagosBusinessDate(entry.occurredAt);
        if (options?.from && date < options.from) return false;
        if (options?.to && date > options.to) return false;
        return true;
      })
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .map(toAccountLedgerEntryDto);
    return jsonClone(entries);
  },

  async getMigrationNotice() {
    await delay();
    const store = readMockStore();
    const exists = store.auditLogs.some(
      (entry) => entry.id === ACCOUNT_MIGRATION_RECONCILIATION_NOTICE_ID,
    );
    if (!exists) return null;
    const key = `fabtyna:notice-seen:${ACCOUNT_MIGRATION_RECONCILIATION_NOTICE_ID}`;
    if (typeof window !== "undefined" && window.localStorage.getItem(key) !== null) {
      return null;
    }
    return {
      id: ACCOUNT_MIGRATION_RECONCILIATION_NOTICE_ID,
      title: "Count and reconcile your accounts",
      message:
        "Legacy money records have been carried into Cash on hand and Moniepoint. Count the money each account actually holds, then use Reconcile to match its balance. This keeps the migrated ledger aligned with today's real balances.",
    };
  },

  async dismissMigrationNotice(id) {
    await delay();
    if (id !== ACCOUNT_MIGRATION_RECONCILIATION_NOTICE_ID) {
      throw new RangeError("This account migration notice is not recognized.");
    }
    if (typeof window === "undefined") {
      throw new Error("Migration notices can only be acknowledged in a browser.");
    }
    window.localStorage.setItem(`fabtyna:notice-seen:${id}`, "dismissed");
  },
};
