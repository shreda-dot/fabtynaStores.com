import type {
  AccountLedgerEntry,
  Purchase,
  PurchaseLine,
  StockMovement,
  SupplierLedgerEntry,
  SupplierPayment,
} from "@fabtyna/shared";
import { counted, insertAuditLog, type AuditWrite, type TxContext } from "../../lib/tx.js";

/**
 * Everything the purchases service needs from the database, as plain functions
 * over one interactive transaction. Fixed round trips per call: one locking
 * query per table, one `createMany` per table. The generic locks (products,
 * stock, accounts) are in lib/locks.ts and shared with sales.
 */

export interface LockedSupplier {
  id: string;
  name: string;
  deletedAt: Date | null;
}

/**
 * Locks supplier rows FOR SHARE (last lock). Sharing is enough: we only need
 * the supplier to exist and stay active until we commit; two purchases from one
 * supplier must not serialize on it.
 */
export async function lockSuppliers(
  ctx: TxContext,
  supplierIds: readonly string[],
): Promise<Map<string, LockedSupplier>> {
  const ids = [...new Set(supplierIds)].sort();
  if (ids.length === 0) {
    return new Map();
  }
  counted(ctx);
  const rows = await ctx.tx.$queryRaw<LockedSupplier[]>`
    SELECT id, name, "deletedAt"
      FROM suppliers
     WHERE id = ANY(${ids}::text[])
     ORDER BY id
       FOR SHARE`;
  return new Map(rows.map((row) => [row.id, row]));
}

/** Locks one purchase row. Always the FIRST lock a request takes. */
export async function lockPurchase(ctx: TxContext, purchaseId: string): Promise<Purchase | null> {
  counted(ctx);
  const rows = await ctx.tx.$queryRaw<Purchase[]>`
    SELECT id, "supplierId", "createdById", status, reference, notes, "totalKobo", "paidKobo",
           "dueDate", "purchasedAt", "receivedAt", "createdAt", "updatedAt"
      FROM purchases
     WHERE id = ${purchaseId}
       FOR UPDATE`;
  return rows[0] ?? null;
}

export async function nextPurchaseSequence(ctx: TxContext): Promise<bigint> {
  counted(ctx);
  const rows = await ctx.tx.$queryRaw<Array<{ n: string }>>`
    SELECT nextval('purchase_reference_seq')::text AS n`;
  return BigInt(rows[0]!.n);
}

/** Money paid at receipt: the account entry and, with a supplier, the payment row and its ledger entry. */
export interface PaidAtReceipt {
  supplierPayment: SupplierPayment | null;
  supplierLedgerEntry: SupplierLedgerEntry | null;
  accountEntry: AccountLedgerEntry;
}

export interface PurchaseWrite {
  purchase: Purchase;
  lines: PurchaseLine[];
  movements: StockMovement[];
  supplierLedgerEntry: SupplierLedgerEntry | null;
  /** Money paid at receipt, as a list: 0 or 1 entries today. */
  payments: PaidAtReceipt[];
  productUpdates: ReadonlyArray<{ id: string; averageCostKobo: bigint }>;
  actorId: string;
}

const byProductLocationId = (a: StockMovement, b: StockMovement): number =>
  (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0) ||
  (a.location < b.location ? -1 : a.location > b.location ? 1 : 0) ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** One statement: sets every product's average cost from parallel arrays. */
export async function updateProductCosts(
  ctx: TxContext,
  updates: ReadonlyArray<{ id: string; averageCostKobo: bigint }>,
): Promise<void> {
  if (updates.length === 0) {
    return;
  }
  counted(ctx);
  const ids = updates.map((update) => update.id);
  const costs = updates.map((update) => update.averageCostKobo.toString());
  await ctx.tx.$executeRaw`
    UPDATE products AS p
       SET "averageCostKobo" = v.cost::bigint, "updatedAt" = CURRENT_TIMESTAMP
      FROM unnest(${ids}::text[], ${costs}::text[]) AS v(id, cost)
     WHERE p.id = v.id`;
}

/**
 * Writes a received purchase in an order that satisfies every foreign key and
 * trigger: purchase, lines, stock movements (sorted), supplier PURCHASE entry,
 * supplier payments, their ledger entries, account entries, product costs.
 */
export async function insertPurchase(ctx: TxContext, write: PurchaseWrite) {
  const { tx } = ctx;
  const { purchase } = write;

  counted(ctx);
  const stored = await tx.purchase.create({
    data: {
      id: purchase.id,
      supplierId: purchase.supplierId,
      createdById: write.actorId,
      status: "RECEIVED",
      reference: purchase.reference,
      notes: purchase.notes,
      totalKobo: purchase.totalKobo,
      paidKobo: purchase.paidKobo,
      dueDate: purchase.dueDate,
      purchasedAt: purchase.purchasedAt,
      receivedAt: purchase.receivedAt,
    },
  });

  counted(ctx);
  await tx.purchaseLine.createMany({
    data: write.lines.map((line) => ({
      id: line.id,
      purchaseId: purchase.id,
      productId: line.productId,
      unit: line.unit,
      // NUMERIC(12,4) receives the decimal string, never a float.
      quantity: String(line.quantity),
      unitsPerPackSnapshot: line.unitsPerPackSnapshot,
      quantityUnits: line.quantityUnits,
      unitCostKobo: line.unitCostKobo,
      lineTotalKobo: line.lineTotalKobo,
    })),
  });

  counted(ctx);
  await tx.stockMovement.createMany({
    data: [...write.movements].sort(byProductLocationId).map((movement) => ({
      id: movement.id,
      productId: movement.productId,
      location: movement.location,
      type: "PURCHASE" as const,
      quantityUnits: movement.quantityUnits,
      unitCostKobo: movement.unitCostKobo,
      purchaseLineId: movement.purchaseLineId,
      occurredAt: movement.occurredAt,
    })),
  });

  if (write.supplierLedgerEntry !== null) {
    const entry = write.supplierLedgerEntry;
    counted(ctx);
    await tx.supplierLedgerEntry.create({
      data: {
        id: entry.id,
        supplierId: entry.supplierId,
        type: "PURCHASE",
        amountKobo: entry.amountKobo,
        purchaseId: purchase.id,
        occurredAt: entry.occurredAt,
      },
    });
  }

  const supplierPayments = write.payments.flatMap((p) => (p.supplierPayment ? [p.supplierPayment] : []));
  if (supplierPayments.length > 0) {
    counted(ctx);
    await tx.supplierPayment.createMany({
      data: supplierPayments.map((payment) => ({
        id: payment.id,
        supplierId: payment.supplierId,
        purchaseId: payment.purchaseId,
        accountId: payment.accountId,
        method: payment.method,
        amountKobo: payment.amountKobo,
        note: payment.note,
        paidAt: payment.paidAt,
      })),
    });
  }

  const paymentLedger = write.payments.flatMap((p) => (p.supplierLedgerEntry ? [p.supplierLedgerEntry] : []));
  if (paymentLedger.length > 0) {
    counted(ctx);
    await tx.supplierLedgerEntry.createMany({
      data: paymentLedger.map((entry) => ({
        id: entry.id,
        supplierId: entry.supplierId,
        type: "PAYMENT" as const,
        amountKobo: entry.amountKobo,
        supplierPaymentId: entry.supplierPaymentId,
        occurredAt: entry.occurredAt,
      })),
    });
  }

  if (write.payments.length > 0) {
    counted(ctx);
    await tx.accountLedgerEntry.createMany({
      data: write.payments.map(({ accountEntry }) => ({
        id: accountEntry.id,
        accountId: accountEntry.accountId,
        type: accountEntry.type as "SUPPLIER_PAYMENT" | "PURCHASE_PAYMENT",
        amountKobo: accountEntry.amountKobo,
        supplierPaymentId: accountEntry.supplierPaymentId,
        purchaseId: accountEntry.purchaseId,
        occurredAt: accountEntry.occurredAt,
      })),
    });
  }

  await updateProductCosts(ctx, write.productUpdates);
  return stored;
}

export async function insertPurchaseAudit(ctx: TxContext, audit: AuditWrite): Promise<void> {
  await insertAuditLog(ctx, "purchase", audit);
}

/** The rows a void needs, read AFTER the purchase lock. */
export interface PurchaseParts {
  lines: PurchaseLine[];
  supplierPayments: SupplierPayment[];
}

export async function loadPurchaseParts(ctx: TxContext, purchaseId: string): Promise<PurchaseParts> {
  counted(ctx);
  const lines = await ctx.tx.purchaseLine.findMany({ where: { purchaseId }, orderBy: { id: "asc" } });
  counted(ctx);
  const supplierPayments = await ctx.tx.supplierPayment.findMany({ where: { purchaseId } });
  return {
    lines: lines.map((line) => ({ ...line, quantity: Number(line.quantity) })),
    supplierPayments,
  };
}

export interface PurchaseLedgers {
  supplierLedger: SupplierLedgerEntry[];
  accountLedger: AccountLedgerEntry[];
}

/** The purchase's own ledger rows (including reversals, which keep the source ids). Needs only the purchase lock. */
export async function loadPurchaseLedgers(ctx: TxContext, purchaseId: string): Promise<PurchaseLedgers> {
  counted(ctx);
  const supplierLedger = await ctx.tx.supplierLedgerEntry.findMany({ where: { purchaseId } });
  counted(ctx);
  const accountLedger = await ctx.tx.accountLedgerEntry.findMany({ where: { purchaseId } });
  return { supplierLedger, accountLedger };
}

/**
 * EVERY movement of the affected products: the domain recomputes average cost
 * from them. Read only AFTER the product rows are locked, so a concurrent
 * purchase of the same product has already committed.
 */
export async function loadProductMovements(
  ctx: TxContext,
  productIds: readonly string[],
): Promise<StockMovement[]> {
  counted(ctx);
  return ctx.tx.stockMovement.findMany({ where: { productId: { in: [...productIds] } } });
}


/** A payment made later: the payment row, the supplier PAYMENT entry, the account entry, the new paidKobo. */
export interface LaterPurchasePaymentWrite {
  purchaseId: string;
  payment: SupplierPayment;
  supplierLedgerEntry: SupplierLedgerEntry;
  accountEntry: AccountLedgerEntry;
  newPaidKobo: bigint;
}

export async function insertLaterPurchasePayment(ctx: TxContext, write: LaterPurchasePaymentWrite) {
  const { tx } = ctx;

  counted(ctx);
  await tx.supplierPayment.create({
    data: {
      id: write.payment.id,
      supplierId: write.payment.supplierId,
      purchaseId: write.purchaseId,
      accountId: write.payment.accountId,
      method: write.payment.method,
      amountKobo: write.payment.amountKobo,
      note: write.payment.note,
      paidAt: write.payment.paidAt,
    },
  });

  counted(ctx);
  await tx.supplierLedgerEntry.create({
    data: {
      id: write.supplierLedgerEntry.id,
      supplierId: write.supplierLedgerEntry.supplierId,
      type: "PAYMENT",
      amountKobo: write.supplierLedgerEntry.amountKobo,
      supplierPaymentId: write.supplierLedgerEntry.supplierPaymentId,
      occurredAt: write.supplierLedgerEntry.occurredAt,
    },
  });

  counted(ctx);
  await tx.accountLedgerEntry.create({
    data: {
      id: write.accountEntry.id,
      accountId: write.accountEntry.accountId,
      type: "SUPPLIER_PAYMENT",
      amountKobo: write.accountEntry.amountKobo,
      supplierPaymentId: write.accountEntry.supplierPaymentId,
      occurredAt: write.accountEntry.occurredAt,
    },
  });

  counted(ctx);
  return tx.purchase.update({ where: { id: write.purchaseId }, data: { paidKobo: write.newPaidKobo } });
}

export interface PurchaseVoidWrite {
  purchaseId: string;
  reversalMovements: StockMovement[];
  reversalSupplierLedgerEntry: SupplierLedgerEntry | null;
  reversalAccountLedgerEntries: AccountLedgerEntry[];
  productUpdates: ReadonlyArray<{ id: string; averageCostKobo: bigint }>;
}

/**
 * Writes the reversals in dependency order, then flips the purchase to VOIDED.
 * `paidKobo` is deliberately untouched (document lock); reports must ignore
 * VOIDED purchases.
 */
export async function insertPurchaseVoid(ctx: TxContext, write: PurchaseVoidWrite) {
  const { tx } = ctx;

  if (write.reversalMovements.length > 0) {
    counted(ctx);
    await tx.stockMovement.createMany({
      data: [...write.reversalMovements].sort(byProductLocationId).map((movement) => ({
        id: movement.id,
        productId: movement.productId,
        location: movement.location,
        type: "PURCHASE" as const,
        quantityUnits: movement.quantityUnits,
        unitCostKobo: movement.unitCostKobo,
        purchaseLineId: movement.purchaseLineId,
        reversesEntryId: movement.reversesEntryId,
        occurredAt: movement.occurredAt,
      })),
    });
  }

  if (write.reversalSupplierLedgerEntry !== null) {
    const entry = write.reversalSupplierLedgerEntry;
    counted(ctx);
    await tx.supplierLedgerEntry.create({
      data: {
        id: entry.id,
        supplierId: entry.supplierId,
        type: entry.type,
        amountKobo: entry.amountKobo,
        purchaseId: entry.purchaseId,
        supplierPaymentId: entry.supplierPaymentId,
        reversesEntryId: entry.reversesEntryId,
        note: entry.note,
        occurredAt: entry.occurredAt,
      },
    });
  }

  if (write.reversalAccountLedgerEntries.length > 0) {
    counted(ctx);
    await tx.accountLedgerEntry.createMany({
      data: write.reversalAccountLedgerEntries.map((entry) => ({
        id: entry.id,
        accountId: entry.accountId,
        type: entry.type,
        amountKobo: entry.amountKobo,
        purchaseId: entry.purchaseId,
        supplierPaymentId: entry.supplierPaymentId,
        reversesEntryId: entry.reversesEntryId,
        note: entry.note,
        occurredAt: entry.occurredAt,
      })),
    });
  }

  await updateProductCosts(ctx, write.productUpdates);

  counted(ctx);
  return tx.purchase.update({ where: { id: write.purchaseId }, data: { status: "VOIDED" } });
}
