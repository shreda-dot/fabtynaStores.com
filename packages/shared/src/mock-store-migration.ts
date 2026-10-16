/**
 * Non-destructive migration for the localStorage-backed mock store.
 *
 * Lives in `shared` (rather than inside the web app's mock-store) so it stays a
 * pure function over plain data and can be unit-tested. It never drops rows and
 * never resets a collection: unknown keys are preserved, missing collections
 * are created empty, and new fields are back-filled only when absent.
 */

export const MOCK_STORE_CURRENT_VERSION = 5;

type PersistedShape = Record<string, unknown>;

const ALL_COLLECTIONS = [
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
] as const;

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): PersistedShape | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as PersistedShape;
  }
  return null;
}

export interface MockStoreMigrationResult {
  version: number;
  data: PersistedShape;
}

/**
 * Migrates a decoded mock-store payload forward to
 * `MOCK_STORE_CURRENT_VERSION`. Returns `null` when the payload cannot be
 * migrated (not an object, or a version from the future) so the caller can fall
 * back to a reseed.
 */
export function migrateMockStoreData(
  version: number,
  data: unknown,
): MockStoreMigrationResult | null {
  if (!Number.isInteger(version) || version < 1) return null;
  if (version > MOCK_STORE_CURRENT_VERSION) return null;

  const root = asRecord(data);
  if (root === null) return null;

  const next: PersistedShape = { ...root };

  // Additive: guarantee every collection exists so older payloads do not blow
  // up readers that assume an array.
  for (const key of ALL_COLLECTIONS) {
    if (!Array.isArray(next[key])) {
      next[key] = [];
    }
  }

  // v4 -> v5: purchases gained `paidKobo` and `dueDate`. Legacy purchases had
  // no credit concept, so they default to fully paid (paidKobo = totalKobo).
  next.purchases = asArray(next.purchases).map((row) => {
    const purchase = asRecord(row);
    if (purchase === null) return row;
    const totalKobo = purchase.totalKobo;
    const hasPaid = typeof purchase.paidKobo === "string";
    return {
      ...purchase,
      paidKobo: hasPaid
        ? purchase.paidKobo
        : typeof totalKobo === "string"
          ? totalKobo
          : "0",
      dueDate: purchase.dueDate === undefined ? null : purchase.dueDate,
    };
  });

  // v4 -> v5: expenses gained `loanRepaymentId`.
  next.expenses = asArray(next.expenses).map((row) => {
    const expense = asRecord(row);
    if (expense === null) return row;
    return {
      ...expense,
      loanRepaymentId:
        expense.loanRepaymentId === undefined ? null : expense.loanRepaymentId,
    };
  });

  return { version: MOCK_STORE_CURRENT_VERSION, data: next };
}
