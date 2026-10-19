import {
  fromAccountDto,
  fromAccountLedgerEntryDto,
  fromAccountTransferDto,
  fromAuditLogDto,
  fromCashSnapshotDto,
  fromCustomerDto,
  fromCustomerLedgerEntryDto,
  fromExpenseDto,
  fromLoanDto,
  fromLoanLedgerEntryDto,
  fromLoanRepaymentDto,
  fromProductDto,
  fromPurchaseDto,
  fromPurchaseLineDto,
  fromSaleDto,
  fromSaleLineDto,
  fromSalePaymentDto,
  fromStockAdjustmentDto,
  fromStockAdjustmentLineDto,
  fromStockMovementDto,
  fromStockTransferDto,
  fromStockTransferLegDto,
  fromStockTransferLineDto,
  fromSupplierDto,
  fromSupplierLedgerEntryDto,
  fromSupplierPaymentDto,
  toAccountDto,
  toAccountLedgerEntryDto,
  toAccountTransferDto,
  toAuditLogDto,
  toCashSnapshotDto,
  toCustomerDto,
  toCustomerLedgerEntryDto,
  toExpenseDto,
  toLoanDto,
  toLoanLedgerEntryDto,
  toLoanRepaymentDto,
  toProductDto,
  toPurchaseDto,
  toPurchaseLineDto,
  toSaleDto,
  toSaleLineDto,
  toSalePaymentDto,
  toStockAdjustmentDto,
  toStockAdjustmentLineDto,
  toStockMovementDto,
  toStockTransferDto,
  toStockTransferLegDto,
  toStockTransferLineDto,
  toSupplierDto,
  toSupplierLedgerEntryDto,
  toSupplierPaymentDto,
  type Account,
  type AccountLedgerEntry,
  type AccountTransfer,
  type AccountType,
  type AuditLog,
  type CashSnapshot,
  type Customer,
  type CustomerLedgerEntry,
  type Expense,
  type Loan,
  type LoanLedgerEntry,
  type LoanRepayment,
  type Product,
  type Purchase,
  type PurchaseLine,
  type Sale,
  type SaleLine,
  type SalePayment,
  type StockAdjustment,
  type StockAdjustmentLine,
  type StockMovement,
  type StockTransfer,
  type StockTransferLeg,
  type StockTransferLine,
  type Supplier,
  type SupplierLedgerEntry,
  type SupplierPayment,
} from "@fabtyna/shared";
import type {
  AccountDto,
  AccountLedgerEntryDto,
  AccountTransferDto,
  AuditLogDto,
  CashSnapshotDto,
  CustomerDto,
  CustomerLedgerEntryDto,
  ExpenseDto,
  LoanDto,
  LoanLedgerEntryDto,
  LoanRepaymentDto,
  ProductDto,
  PurchaseDto,
  PurchaseLineDto,
  SaleDto,
  SaleLineDto,
  SalePaymentDto,
  StockAdjustmentDto,
  StockAdjustmentLineDto,
  StockMovementDto,
  StockTransferDto,
  StockTransferLegDto,
  StockTransferLineDto,
  SupplierDto,
  SupplierLedgerEntryDto,
  SupplierPaymentDto,
} from "@fabtyna/shared";
import {
  assertStoreInvariants,
  MOCK_STORE_CURRENT_VERSION,
  migrateMockStoreData,
} from "@fabtyna/shared";

export type MockStore = {
  products: Product[];
  suppliers: Supplier[];
  customers: Customer[];
  purchases: Purchase[];
  purchaseLines: PurchaseLine[];
  sales: Sale[];
  saleLines: SaleLine[];
  salePayments: SalePayment[];
  stockTransfers: StockTransfer[];
  stockTransferLines: StockTransferLine[];
  stockTransferLegs: StockTransferLeg[];
  stockAdjustments: StockAdjustment[];
  stockAdjustmentLines: StockAdjustmentLine[];
  stockMovements: StockMovement[];
  supplierLedgerEntries: SupplierLedgerEntry[];
  supplierPayments: SupplierPayment[];
  customerLedgerEntries: CustomerLedgerEntry[];
  expenses: Expense[];
  loans: Loan[];
  loanLedgerEntries: LoanLedgerEntry[];
  loanRepayments: LoanRepayment[];
  cashSnapshots: CashSnapshot[];
  auditLogs: AuditLog[];
  accounts: Account[];
  accountLedgerEntries: AccountLedgerEntry[];
  accountTransfers: AccountTransfer[];
};

type PersistedMockStore = {
  products: ProductDto[];
  suppliers: SupplierDto[];
  customers: CustomerDto[];
  purchases: PurchaseDto[];
  purchaseLines: PurchaseLineDto[];
  sales: SaleDto[];
  saleLines: SaleLineDto[];
  salePayments: SalePaymentDto[];
  stockTransfers: StockTransferDto[];
  stockTransferLines: StockTransferLineDto[];
  stockTransferLegs: StockTransferLegDto[];
  stockAdjustments: StockAdjustmentDto[];
  stockAdjustmentLines: StockAdjustmentLineDto[];
  stockMovements: StockMovementDto[];
  supplierLedgerEntries: SupplierLedgerEntryDto[];
  supplierPayments: SupplierPaymentDto[];
  customerLedgerEntries: CustomerLedgerEntryDto[];
  expenses: ExpenseDto[];
  loans: LoanDto[];
  loanLedgerEntries: LoanLedgerEntryDto[];
  loanRepayments: LoanRepaymentDto[];
  cashSnapshots: CashSnapshotDto[];
  auditLogs: AuditLogDto[];
  accounts: AccountDto[];
  accountLedgerEntries: AccountLedgerEntryDto[];
  accountTransfers: AccountTransferDto[];
};

type PersistedPayload = {
  version: number;
  data: PersistedMockStore;
};

const STORAGE_KEY = "fabtyna-mock-v1";
const BACKUP_KEY = "fabtyna-mock-v1-backup";
const CURRENT_VERSION = MOCK_STORE_CURRENT_VERSION;

let idFallbackCounter = 0;

export function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to fallback
  }
  idFallbackCounter += 1;
  const rnd = Math.random().toString(36).slice(2, 10);
  return `id-${Date.now().toString(36)}-${rnd}-${idFallbackCounter.toString(36)}`;
}

function now(): Date {
  return new Date();
}

function normalizeSku(sku: string | null): string | null {
  if (sku === null) return null;
  const trimmed = sku.trim().toUpperCase();
  return trimmed === "" ? null : trimmed;
}

/**
 * Fixed ids for the two accounts every store starts with. They match the ids
 * the v6 -> v7 migration stamps onto migrated payloads, so a migrated store and
 * a freshly seeded one agree on which account money lands in.
 */
const DEFAULT_CASH_ACCOUNT_ID = "acct-cash-on-hand";
const DEFAULT_BANK_ACCOUNT_ID = "acct-moniepoint";

/**
 * Picks the account a money movement belongs to. Until the account pickers
 * ship, callers name nothing and the movement lands in the first active
 * account of the preferred type: the bank account for a transfer, otherwise
 * cash on hand.
 */
export function resolveAccountId(
  accounts: readonly Account[],
  requested: string | null | undefined,
  preferredType: AccountType = "CASH",
): string {
  if (requested) return requested;
  const active = accounts.filter((account) => account.isActive);
  const match =
    active.find((account) => account.type === preferredType) ?? active[0];
  if (!match) {
    throw new Error("No active account is available to record this money movement.");
  }
  return match.id;
}

function seedDemoData(): MockStore {
  const createdAt = now();
  const products: Product[] = [
    { name: "LEGEND", sku: "LEGEND-CRATE", category: "BEER", unitsPerPack: 12, saleChannel: "BOTH", retailPriceKobo: 150000n, wholesalePriceKobo: 1220000n, averageCostKobo: 94167n, reorderLevelUnits: 36 },
    { name: "BUDWISER", sku: "BUDWISER-CRATE", category: "BEER", unitsPerPack: 12, saleChannel: "BOTH", retailPriceKobo: 130000n, wholesalePriceKobo: 1180000n, averageCostKobo: 86667n, reorderLevelUnits: 36 },
    { name: "BIG HEHEINEKEN", sku: "BIG-HEINEKEN-CRATE", category: "BEER", unitsPerPack: 12, saleChannel: "BOTH", retailPriceKobo: 160000n, wholesalePriceKobo: 1490000n, averageCostKobo: 115833n, reorderLevelUnits: 36 },
    { name: "GOLDBERG", sku: "GOLDBERG-CRATE", category: "BEER", unitsPerPack: 12, saleChannel: "BOTH", retailPriceKobo: 120000n, wholesalePriceKobo: 1000000n, averageCostKobo: 76667n, reorderLevelUnits: 36 },
    { name: "TROPHY", sku: "TROPHY-CRATE", category: "BEER", unitsPerPack: 12, saleChannel: "BOTH", retailPriceKobo: 100000n, wholesalePriceKobo: 900000n, averageCostKobo: 69167n, reorderLevelUnits: 36 },
    { name: "CASTLE LYTE", sku: "CASTLE-LYTE-CRATE", category: "BEER", unitsPerPack: 12, saleChannel: "BOTH", retailPriceKobo: 110000n, wholesalePriceKobo: 1030000n, averageCostKobo: 76667n, reorderLevelUnits: 36 },
    { name: "SMALL STOUT", sku: "SMALL-STOUT-CRATE", category: "BEER", unitsPerPack: 24, saleChannel: "BOTH", retailPriceKobo: 120000n, wholesalePriceKobo: 2040000n, averageCostKobo: 76667n, reorderLevelUnits: 36 },
    { name: "SMALL HEINKEN", sku: "SM-HEINIKEIN", category: "BEER", unitsPerPack: 20, saleChannel: "BOTH", retailPriceKobo: 120000n, wholesalePriceKobo: 1920000n, averageCostKobo: 76667n, reorderLevelUnits: 36 },
    { name: "DESPERDO", sku: "DESPERDO-CRATE", category: "BEER", unitsPerPack: 20, saleChannel: "BOTH", retailPriceKobo: 130000n, wholesalePriceKobo: 2220000n, averageCostKobo: 86667n, reorderLevelUnits: 36 },
    { name: "MALTA GUINIESS", sku: "MALTA-GUINIESS-CRATE", category: "BEER", unitsPerPack: 24, saleChannel: "BOTH", retailPriceKobo: 80000n, wholesalePriceKobo: 1400000n, averageCostKobo: 76667n, reorderLevelUnits: 20 },
    { name: "BIG STOUT", sku: "BIG-STOUT-CRATE", category: "BEER", unitsPerPack: 12, saleChannel: "BOTH", retailPriceKobo: 200000n, wholesalePriceKobo: 1640000n, averageCostKobo: 86667n, reorderLevelUnits: 15 },
    { name: "TROPHY CAN", sku: "TROPHY-CAN-CRATE", category: "BEER", unitsPerPack: 24, saleChannel: "BOTH", retailPriceKobo: 100000n, wholesalePriceKobo: 1540000n, averageCostKobo: 86667n, reorderLevelUnits: 12 },
    { name: "FLYING FISH", sku: "FLYING FISH", category: "BEER", unitsPerPack: 20, saleChannel: "BOTH", retailPriceKobo: 120000n, wholesalePriceKobo: 1450000n, averageCostKobo: 86667n, reorderLevelUnits: 12 },
    { name: "GULDER", sku: "GULDER-CRATE", category: "BEER", unitsPerPack: 12, saleChannel: "BOTH", retailPriceKobo: 130000n, wholesalePriceKobo: 1260000n, averageCostKobo: 86667n, reorderLevelUnits: 20 },
    { name: "SMALL ICE", sku: "SMALL-ICE-CRATE", category: "BEER", unitsPerPack: 24, saleChannel: "BOTH", retailPriceKobo: 120000n, wholesalePriceKobo: 1840000n, averageCostKobo: 86667n, reorderLevelUnits: 12 },
    { name: "33", sku: "33-CRATE", category: "BEER", unitsPerPack: 12, saleChannel: "BOTH", retailPriceKobo: 120000n, wholesalePriceKobo: 980000n, averageCostKobo: 76667n, reorderLevelUnits: 36 },
    { name: "ORIGIN BITTERS", sku: "ORIGIN-BITTERS-CRATE", category: "BEER", unitsPerPack: 12, saleChannel: "BOTH", retailPriceKobo: 130000n, wholesalePriceKobo: 920000n, averageCostKobo: 76667n, reorderLevelUnits: 12 },
    { name: "STAR", sku: "STAR-CRATE", category: "BEER", unitsPerPack: 12, saleChannel: "BOTH", retailPriceKobo: 130000n, wholesalePriceKobo: 1180000n, averageCostKobo: 86667n, reorderLevelUnits: 36 },
  ].map((p) => ({
    id: newId(),
    name: p.name,
    sku: normalizeSku(p.sku),
    category: p.category as Product["category"],
    packName: "crate",
    unitsPerPack: p.unitsPerPack,
    saleChannel: p.saleChannel as Product["saleChannel"],
    retailPriceKobo: p.retailPriceKobo,
    wholesalePriceKobo: p.wholesalePriceKobo,
    averageCostKobo: p.averageCostKobo,
    reorderLevelUnits: p.reorderLevelUnits,
    deletedAt: null,
    createdAt,
    updatedAt: createdAt,
  }));

  const suppliers: Supplier[] = [
    {
      id: newId(),
      name: "Lagos Beverage Distributors",
      phone: "+234 803 555 0101",
      email: "orders@lagosbeverage.example",
      address: "Ikeja, Lagos",
      notes: "Primary beer supplier",
      deletedAt: null,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: newId(),
      name: "West Coast Drinks Ltd",
      phone: "+234 802 555 0182",
      email: "sales@westcoastdrinks.example",
      address: "Apapa, Lagos",
      notes: "Soft drinks and malt",
      deletedAt: null,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: newId(),
      name: "Mainland Bottling Supply",
      phone: "+234 809 555 0144",
      email: null,
      address: "Yaba, Lagos",
      notes: null,
      deletedAt: null,
      createdAt,
      updatedAt: createdAt,
    },
  ];

  const customers: Customer[] = [
    {
      id: newId(),
      name: "Mr. Adebayo",
      type: "WHOLESALE",
      creditLimitKobo: 50000000n,
      phone: "+234 803 555 0201",
      email: null,
      address: "Surulere, Lagos",
      notes: "Bulk buyer, pays monthly",
      deletedAt: null,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: newId(),
      name: "Chidi's Bar",
      type: "RETAIL",
      creditLimitKobo: 10000000n,
      phone: "+234 805 555 0233",
      email: "chidi@example.com",
      address: "Yaba, Lagos",
      notes: null,
      deletedAt: null,
      createdAt,
      updatedAt: createdAt,
    },
  ];

  return {
    products,
    suppliers,
    customers,
    purchases: [],
    purchaseLines: [],
    sales: [],
    saleLines: [],
    salePayments: [],
    stockTransfers: [],
    stockTransferLines: [],
    stockTransferLegs: [],
    stockAdjustments: [],
    stockAdjustmentLines: [],
    stockMovements: [],
    supplierLedgerEntries: [],
    supplierPayments: [],
    customerLedgerEntries: [],
    expenses: [],
    loans: [],
    loanLedgerEntries: [],
    loanRepayments: [],
    cashSnapshots: [],
    auditLogs: [],
    accounts: [
      {
        id: DEFAULT_CASH_ACCOUNT_ID,
        name: "Cash on hand",
        type: "CASH",
        isActive: true,
        deactivatedAt: null,
        note: "Money physically in the drawer.",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: DEFAULT_BANK_ACCOUNT_ID,
        name: "Moniepoint",
        type: "BANK",
        isActive: true,
        deactivatedAt: null,
        note: "Bank / transfer account.",
        createdAt,
        updatedAt: createdAt,
      },
    ],
    accountLedgerEntries: [],
    accountTransfers: [],
  };
}

function encodeStore(store: MockStore): PersistedMockStore {
  return {
    products: store.products.map(toProductDto),
    suppliers: store.suppliers.map(toSupplierDto),
    customers: store.customers.map(toCustomerDto),
    purchases: store.purchases.map(toPurchaseDto),
    purchaseLines: store.purchaseLines.map(toPurchaseLineDto),
    sales: store.sales.map(toSaleDto),
    saleLines: store.saleLines.map(toSaleLineDto),
    salePayments: store.salePayments.map(toSalePaymentDto),
    stockTransfers: store.stockTransfers.map(toStockTransferDto),
    stockTransferLines: store.stockTransferLines.map(toStockTransferLineDto),
    stockTransferLegs: store.stockTransferLegs.map(toStockTransferLegDto),
    stockAdjustments: store.stockAdjustments.map(toStockAdjustmentDto),
    stockAdjustmentLines: store.stockAdjustmentLines.map(toStockAdjustmentLineDto),
    stockMovements: store.stockMovements.map(toStockMovementDto),
    supplierLedgerEntries: store.supplierLedgerEntries.map(toSupplierLedgerEntryDto),
    supplierPayments: store.supplierPayments.map(toSupplierPaymentDto),
    customerLedgerEntries: store.customerLedgerEntries.map(toCustomerLedgerEntryDto),
    expenses: store.expenses.map(toExpenseDto),
    loans: store.loans.map(toLoanDto),
    loanLedgerEntries: store.loanLedgerEntries.map(toLoanLedgerEntryDto),
    loanRepayments: store.loanRepayments.map(toLoanRepaymentDto),
    cashSnapshots: store.cashSnapshots.map(toCashSnapshotDto),
    auditLogs: store.auditLogs.map(toAuditLogDto),
    accounts: store.accounts.map(toAccountDto),
    accountLedgerEntries: store.accountLedgerEntries.map(toAccountLedgerEntryDto),
    accountTransfers: store.accountTransfers.map(toAccountTransferDto),
  };
}

function decodeStore(value: unknown): MockStore {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Mock storage must contain an object.");
  }
  const data = value as Record<string, unknown>;
  if (typeof data.version !== "number") {
    throw new TypeError("Mock storage payload is missing a version.");
  }
  if (typeof data.data !== "object" || data.data === null) {
    throw new TypeError("Mock storage payload is missing data.");
  }

  // NON-DESTRUCTIVE: migrate older payloads forward instead of throwing (which
  // would wipe the user's data via a reseed). A future version cannot be
  // understood, so we throw to signal the caller to reseed.
  const migration = migrateMockStoreData(data.version, data.data);
  if (migration === null) {
    throw new RangeError(`Unsupported mock storage version: ${data.version}`);
  }

  const raw = migration.data as Record<string, unknown>;
  const saved = {} as PersistedMockStore;
  const keys = [
    "products",
    "suppliers",
    "customers",
    "purchases",
    "purchaseLines",
    "sales",
    "saleLines",
    "salePayments",
    "stockTransfers",
    "stockTransferLines",
    "stockTransferLegs",
    "stockAdjustments",
    "stockAdjustmentLines",
    "stockMovements",
    "supplierLedgerEntries",
    "supplierPayments",
    "customerLedgerEntries",
    "expenses",
    "loans",
    "loanLedgerEntries",
    "loanRepayments",
    "cashSnapshots",
    "auditLogs",
    "accounts",
    "accountLedgerEntries",
    "accountTransfers",
  ] as const;
  for (const key of keys) {
    const value = raw[key];
    if (!Array.isArray(value)) {
      throw new TypeError(`Mock storage field '${key}' must be an array.`);
    }
    (saved as Record<string, unknown>)[key] = value;
  }

  return {
    products: saved.products.map(fromProductDto),
    suppliers: saved.suppliers.map(fromSupplierDto),
    customers: saved.customers.map(fromCustomerDto),
    purchases: saved.purchases.map(fromPurchaseDto),
    purchaseLines: saved.purchaseLines.map(fromPurchaseLineDto),
    sales: saved.sales.map(fromSaleDto),
    saleLines: saved.saleLines.map(fromSaleLineDto),
    salePayments: saved.salePayments.map(fromSalePaymentDto),
    stockTransfers: saved.stockTransfers.map(fromStockTransferDto),
    stockTransferLines: saved.stockTransferLines.map(fromStockTransferLineDto),
    stockTransferLegs: saved.stockTransferLegs.map(fromStockTransferLegDto),
    stockAdjustments: saved.stockAdjustments.map(fromStockAdjustmentDto),
    stockAdjustmentLines: saved.stockAdjustmentLines.map(fromStockAdjustmentLineDto),
    stockMovements: saved.stockMovements.map(fromStockMovementDto),
    supplierLedgerEntries: saved.supplierLedgerEntries.map(fromSupplierLedgerEntryDto),
    supplierPayments: saved.supplierPayments.map(fromSupplierPaymentDto),
    customerLedgerEntries: saved.customerLedgerEntries.map(fromCustomerLedgerEntryDto),
    expenses: saved.expenses.map(fromExpenseDto),
    loans: saved.loans.map(fromLoanDto),
    loanLedgerEntries: saved.loanLedgerEntries.map(fromLoanLedgerEntryDto),
    loanRepayments: saved.loanRepayments.map(fromLoanRepaymentDto),
    cashSnapshots: saved.cashSnapshots.map(fromCashSnapshotDto),
    auditLogs: saved.auditLogs.map(fromAuditLogDto),
    accounts: saved.accounts.map(fromAccountDto),
    accountLedgerEntries: saved.accountLedgerEntries.map(fromAccountLedgerEntryDto),
    accountTransfers: saved.accountTransfers.map(fromAccountTransferDto),
  };
}

let inMemoryMode = false;
let backupNotice = "";

function localStorageAvailable(): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    const testKey = "__fabtyna_test__";
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

function persist(store: MockStore): void {
  try {
    const payload: PersistedPayload = { version: CURRENT_VERSION, data: encodeStore(store) };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    inMemoryMode = true;
  }
}

function loadRawPayload(): { raw: string | null; parsed: MockStore | null } {
  if (!localStorageAvailable()) {
    inMemoryMode = true;
    return { raw: null, parsed: null };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return { raw: null, parsed: null };
    }
    try {
      const parsed = decodeStore(JSON.parse(raw) as unknown);
      return { raw, parsed };
    } catch {
      try {
        window.localStorage.setItem(BACKUP_KEY, raw);
        backupNotice = "Saved data could not be read; it was backed up and demo data was loaded.";
      } catch {
        backupNotice = "Saved data could not be read; demo data was loaded.";
      }
      return { raw, parsed: null };
    }
  } catch {
    inMemoryMode = true;
    return { raw: null, parsed: null };
  }
}

let store: MockStore | null = null;
let loaded = false;

function ensureLoaded(): MockStore {
  if (typeof window === "undefined") {
    throw new Error("The mock API is available only in the browser.");
  }
  if (loaded) {
    if (store === null) throw new Error("Mock store failed to initialize.");
    return store;
  }

  const { parsed } = loadRawPayload();
  if (parsed !== null) {
    store = parsed;
  } else {
    const fresh = seedDemoData();
    persist(fresh);
    store = fresh;
  }
  loaded = true;
  return store;
}

function validateSkuUniqueness(candidate: MockStore): void {
  const activeSkus = new Set<string>();
  for (const product of candidate.products) {
    if (product.deletedAt !== null || product.sku === null) continue;
    const normalizedSku = product.sku.trim().toUpperCase();
    if (normalizedSku === "") continue;
    if (activeSkus.has(normalizedSku)) {
      throw new Error(`SKU '${product.sku}' is already used by an active product.`);
    }
    activeSkus.add(normalizedSku);
  }
}

function jsonOf<T>(row: T, toDto: (row: T) => unknown): string {
  return JSON.stringify(toDto(row));
}

function assertRowsImmutable<T extends { id: string }>(
  label: string,
  previous: readonly T[],
  candidate: readonly T[],
  toDto: (row: T) => unknown,
): void {
  const prevJson = new Map(previous.map((row) => [row.id, jsonOf(row, toDto)]));
  for (const row of previous) {
    const found = candidate.find((c) => c.id === row.id);
    if (!found) {
      throw new Error(`${label} '${row.id}' was removed.`);
    }
    if (jsonOf(found, toDto) !== prevJson.get(row.id)) {
      throw new Error(`${label} '${row.id}' was modified.`);
    }
  }
}

function assertImmutability(previous: MockStore, candidate: MockStore): void {
  const prevMovements = new Map(previous.stockMovements.map((m) => [m.id, jsonOf(m, toStockMovementDto)]));
  for (const m of previous.stockMovements) {
    const cand = candidate.stockMovements.find((cm) => cm.id === m.id);
    if (!cand) {
      throw new Error(`Stock movement '${m.id}' was removed.`);
    }
    if (jsonOf(cand, toStockMovementDto) !== prevMovements.get(m.id)) {
      throw new Error(`Stock movement '${m.id}' was modified.`);
    }
  }

  const prevLedger = new Map(previous.supplierLedgerEntries.map((e) => [e.id, jsonOf(e, toSupplierLedgerEntryDto)]));
  for (const e of previous.supplierLedgerEntries) {
    const cand = candidate.supplierLedgerEntries.find((ce) => ce.id === e.id);
    if (!cand) {
      throw new Error(`Supplier ledger entry '${e.id}' was removed.`);
    }
    if (jsonOf(cand, toSupplierLedgerEntryDto) !== prevLedger.get(e.id)) {
      throw new Error(`Supplier ledger entry '${e.id}' was modified.`);
    }
  }

  const prevAudit = new Map(previous.auditLogs.map((a) => [a.id, jsonOf(a, toAuditLogDto)]));
  for (const a of previous.auditLogs) {
    const cand = candidate.auditLogs.find((ca) => ca.id === a.id);
    if (!cand) {
      throw new Error(`Audit log '${a.id}' was removed.`);
    }
    if (jsonOf(cand, toAuditLogDto) !== prevAudit.get(a.id)) {
      throw new Error(`Audit log '${a.id}' was modified.`);
    }
  }

  const prevProductIds = new Set(previous.products.map((p) => p.id));
  for (const id of prevProductIds) {
    if (!candidate.products.some((p) => p.id === id)) {
      throw new Error(`Product '${id}' was removed.`);
    }
  }

  const prevSupplierIds = new Set(previous.suppliers.map((s) => s.id));
  for (const id of prevSupplierIds) {
    if (!candidate.suppliers.some((s) => s.id === id)) {
      throw new Error(`Supplier '${id}' was removed.`);
    }
  }

  // Accounting ledgers are immutable too.
  assertRowsImmutable("Supplier payment", previous.supplierPayments, candidate.supplierPayments, toSupplierPaymentDto);
  assertRowsImmutable("Loan ledger entry", previous.loanLedgerEntries, candidate.loanLedgerEntries, toLoanLedgerEntryDto);
  assertRowsImmutable("Loan repayment", previous.loanRepayments, candidate.loanRepayments, toLoanRepaymentDto);
  assertRowsImmutable("Cash snapshot", previous.cashSnapshots, candidate.cashSnapshots, toCashSnapshotDto);
  for (const expense of previous.expenses) {
    const updated = candidate.expenses.find((item) => item.id === expense.id);
    if (!updated) {
      throw new Error(`Expense '${expense.id}' was removed.`);
    }
    const before = toExpenseDto(expense);
    const after = toExpenseDto(updated);
    if (
      JSON.stringify({
        ...before,
        voidedAt: null,
        voidReason: null,
        updatedAt: null,
      }) !==
      JSON.stringify({
        ...after,
        voidedAt: null,
        voidReason: null,
        updatedAt: null,
      })
    ) {
      throw new Error(`Expense '${expense.id}' was edited instead of voided.`);
    }
    if (expense.voidedAt === null && updated.voidedAt !== null) {
      if ((updated.voidReason ?? "").trim() === "") {
        throw new Error(`Voiding expense '${expense.id}' requires a reason.`);
      }
      if (updated.updatedAt.getTime() !== updated.voidedAt.getTime()) {
        throw new Error(`Voiding expense '${expense.id}' must update its void timestamp.`);
      }
    } else if (
      updated.voidedAt?.getTime() !== expense.voidedAt?.getTime() ||
      updated.voidReason !== expense.voidReason ||
      updated.updatedAt.getTime() !== expense.updatedAt.getTime()
    ) {
      throw new Error(`Expense '${expense.id}' was modified outside a void transition.`);
    }
  }
  // The account ledger and its transfers are append-only; corrections are
  // reversal rows. The accounts themselves stay editable (rename/deactivate).
  assertRowsImmutable("Account ledger entry", previous.accountLedgerEntries, candidate.accountLedgerEntries, toAccountLedgerEntryDto);
  assertRowsImmutable("Account transfer", previous.accountTransfers, candidate.accountTransfers, toAccountTransferDto);
}

export function transactMockStore<T>(change: (draft: MockStore) => T): T {
  if (typeof window === "undefined") {
    throw new Error("The mock API is available only in the browser.");
  }
  ensureLoaded();
  const freshRaw = loadRawPayload();
  if (freshRaw.parsed !== null) {
    store = freshRaw.parsed;
  }
  const current = structuredClone(store!);
  const draft = structuredClone(current);
  const result = change(draft);

  for (const product of draft.products) {
    product.sku = normalizeSku(product.sku);
  }

  assertImmutability(current, draft);
  validateSkuUniqueness(draft);
  assertStoreInvariants({
    products: draft.products,
    stockMovements: draft.stockMovements,
    stockTransferLegs: draft.stockTransferLegs,
    supplierLedgerEntries: draft.supplierLedgerEntries,
    purchaseLines: draft.purchaseLines,
    stockAdjustmentLines: draft.stockAdjustmentLines,
    purchases: draft.purchases,
    supplierPayments: draft.supplierPayments,
    loanLedgerEntries: draft.loanLedgerEntries,
    cashSnapshots: draft.cashSnapshots,
    expenses: draft.expenses,
    accounts: draft.accounts,
    accountLedgerEntries: draft.accountLedgerEntries,
    accountTransfers: draft.accountTransfers,
  });

  persist(draft);
  store = draft;
  return structuredClone(result);
}

export function readMockStore(): MockStore {
  ensureLoaded();
  const freshRaw = loadRawPayload();
  if (freshRaw.parsed !== null) {
    store = freshRaw.parsed;
  }
  return structuredClone(store!);
}

export function resetDemoData(): void {
  const fresh = seedDemoData();
  persist(fresh);
  store = fresh;
  loaded = true;
  inMemoryMode = false;
  backupNotice = "";
}

export function isMockStoreInMemoryOnly(): boolean {
  return inMemoryMode;
}

export function getMockStoreBackupNotice(): string {
  return backupNotice;
}

export type MockStoreInvalidator = () => void;

let invalidator: MockStoreInvalidator | null = null;

export function setMockStoreInvalidator(fn: MockStoreInvalidator): void {
  invalidator = fn;
}

export function setupMockStoreStorageListener(): () => void {
  if (typeof window === "undefined") return () => { };
  const handler = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      loaded = false;
      store = null;
      if (invalidator) {
        try {
          invalidator();
        } catch {
          // ignore invalidator errors
        }
      }
    }
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
