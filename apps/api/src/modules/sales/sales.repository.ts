import type { Prisma } from "../../../generated/prisma/client.js";
import type {
  AccountLedgerEntry,
  CustomerLedgerEntry,
  Product,
  Sale,
  SaleLine,
  SalePayment,
  StockLocation,
  StockMovement,
} from "@fabtyna/shared";

/**
 * Everything the sales service needs from the database, as plain functions over
 * one interactive transaction. Each function is a fixed number of round trips
 * regardless of how many lines the sale has: rows are read with one locking
 * query per table and written with one `createMany` per table.
 */

// The transaction context, the generic row locks and the audit insert now live
// in lib/ so purchases use the very same ones; re-exported for this module.
import { counted, insertAuditLog, type AuditWrite, type TxContext } from "../../lib/tx.js";

export { setLocalTimeouts, type TxContext } from "../../lib/tx.js";
export {
  lockAccounts,
  lockProducts,
  lockStockBalances,
  stockKey,
  type LockedAccount,
  type StockKey,
} from "../../lib/locks.js";

export interface LockedCustomer {
  id: string;
  name: string;
  type: "RETAIL" | "WHOLESALE";
  deletedAt: Date | null;
}

/** Locks customer rows ordered by id: always the LAST lock a request takes. */
export async function lockCustomers(
  ctx: TxContext,
  customerIds: readonly string[],
): Promise<Map<string, LockedCustomer>> {
  const ids = [...new Set(customerIds)].sort();
  if (ids.length === 0) {
    return new Map();
  }
  counted(ctx);
  const rows = await ctx.tx.$queryRaw<LockedCustomer[]>`
    SELECT id, name, type, "deletedAt"
      FROM customers
     WHERE id = ANY(${ids}::text[])
     ORDER BY id
       FOR UPDATE`;
  return new Map(rows.map((row) => [row.id, row]));
}

/** Locks one sale row. Always the FIRST lock a request takes. */
export async function lockSale(ctx: TxContext, saleId: string): Promise<Sale | null> {
  counted(ctx);
  const rows = await ctx.tx.$queryRaw<Sale[]>`
    SELECT id, "customerId", "customerName", "createdById", channel, status, reference, notes,
           "totalKobo", "paidKobo", "soldAt", "createdAt", "updatedAt"
      FROM sales
     WHERE id = ${saleId}
       FOR UPDATE`;
  return rows[0] ?? null;
}
export async function nextSaleSequence(ctx: TxContext): Promise<bigint> {
  counted(ctx);
  const rows = await ctx.tx.$queryRaw<Array<{ n: string }>>`
    SELECT nextval('sale_reference_seq')::text AS n`;
  return BigInt(rows[0]!.n);
}

/** One entry of money received: the payment row and the account entry it created. */
export interface ReceivedPayment {
  payment: SalePayment;
  accountEntry: AccountLedgerEntry;
}

export interface SaleWrite {
  sale: Sale;
  lines: SaleLine[];
  location: StockLocation;
  movements: StockMovement[];
  customerLedgerEntry: CustomerLedgerEntry | null;
  /** Money received, as a list: 0 or 1 entries today. */
  payments: ReceivedPayment[];
  /** Product average cost at sale time, keyed by product id. */
  costByProductId: ReadonlyMap<string, bigint>;
  actorId: string;
  audit: { afterData: Prisma.InputJsonValue; metadata: Prisma.InputJsonValue };
}

/**
 * Writes the sale in an order that satisfies every foreign key and trigger:
 * sale, lines, stock movements (sorted, so balance rows lock in a fixed order),
 * customer ledger entry, payments, account entries, audit row.
 * Returns the stored sale row.
 */
export async function insertSale(ctx: TxContext, write: SaleWrite) {
  const { tx } = ctx;
  const { sale } = write;

  counted(ctx);
  const stored = await tx.sale.create({
    data: {
      id: sale.id,
      createdById: write.actorId,
      customerId: sale.customerId,
      customerName: sale.customerName,
      channel: sale.channel,
      status: "COMPLETED",
      reference: sale.reference,
      notes: sale.notes,
      totalKobo: sale.totalKobo,
      paidKobo: sale.paidKobo,
      soldAt: sale.soldAt,
    },
  });

  counted(ctx);
  await tx.saleLine.createMany({
    data: write.lines.map((line) => ({
      id: line.id,
      saleId: sale.id,
      productId: line.productId,
      location: write.location,
      unit: line.unit,
      // The number was already proven to have <= 4 decimals and no exponent by
      // the domain; its string form is what NUMERIC(12,4) receives.
      quantity: String(line.quantity),
      unitsPerPackSnapshot: line.unitsPerPackSnapshot,
      quantityUnits: line.quantityUnits,
      unitPriceKobo: line.unitPriceKobo,
      costPerUnitKobo: write.costByProductId.get(line.productId) ?? 0n,
      lineTotalKobo: line.lineTotalKobo,
    })),
  });

  const sortedMovements = [...write.movements].sort(
    (a, b) =>
      (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0) ||
      (a.location < b.location ? -1 : a.location > b.location ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  counted(ctx);
  await tx.stockMovement.createMany({
    data: sortedMovements.map((movement) => ({
      id: movement.id,
      productId: movement.productId,
      location: movement.location,
      type: "SALE" as const,
      quantityUnits: movement.quantityUnits,
      unitCostKobo: movement.unitCostKobo,
      saleLineId: movement.saleLineId,
      occurredAt: movement.occurredAt,
    })),
  });

  if (write.customerLedgerEntry !== null) {
    const entry = write.customerLedgerEntry;
    counted(ctx);
    await tx.customerLedgerEntry.create({
      data: {
        id: entry.id,
        customerId: entry.customerId,
        type: "SALE",
        amountKobo: entry.amountKobo,
        saleId: sale.id,
        occurredAt: entry.occurredAt,
      },
    });
  }

  if (write.payments.length > 0) {
    counted(ctx);
    await tx.salePayment.createMany({
      data: write.payments.map(({ payment }) => ({
        id: payment.id,
        saleId: sale.id,
        accountId: payment.accountId,
        amountKobo: payment.amountKobo,
        paidAt: payment.paidAt,
      })),
    });

    counted(ctx);
    await tx.accountLedgerEntry.createMany({
      data: write.payments.map(({ accountEntry }) => ({
        id: accountEntry.id,
        accountId: accountEntry.accountId,
        type: "SALE_PAYMENT" as const,
        amountKobo: accountEntry.amountKobo,
        salePaymentId: accountEntry.salePaymentId,
        occurredAt: accountEntry.occurredAt,
      })),
    });
  }

  counted(ctx);
  await tx.auditLog.create({
    data: {
      actorId: write.actorId,
      action: "sale.create",
      entityType: "sale",
      entityId: sale.id,
      afterData: write.audit.afterData,
      metadata: write.audit.metadata,
    },
  });

  return stored;
}

/* ------------------------------------------------------------------ *
 * Later payments, void and amend
 * ------------------------------------------------------------------ */

export async function insertSaleAudit(ctx: TxContext, audit: AuditWrite): Promise<void> {
  await insertAuditLog(ctx, "sale", audit);
}

/** The rows a void needs, read AFTER the locks. Quantities are plain numbers like the domain types. */
export interface SaleParts {
  lines: Array<SaleLine & { location: StockLocation }>;
  payments: SalePayment[];
}

export async function loadSaleParts(ctx: TxContext, saleId: string): Promise<SaleParts> {
  counted(ctx);
  const lines = await ctx.tx.saleLine.findMany({ where: { saleId }, orderBy: { id: "asc" } });
  counted(ctx);
  const payments = await ctx.tx.salePayment.findMany({ where: { saleId }, orderBy: { id: "asc" } });
  return {
    lines: lines.map((line) => ({ ...line, quantity: Number(line.quantity) })),
    payments,
  };
}

export interface SaleHistory {
  movements: StockMovement[];
  customerLedger: CustomerLedgerEntry[];
  accountLedger: AccountLedgerEntry[];
}

/** Every row the domain's voidSale looks at for ONE sale, including rows that already reverse others. */
export async function loadSaleHistory(ctx: TxContext, parts: SaleParts, saleId: string): Promise<SaleHistory> {
  const lineIds = parts.lines.map((line) => line.id);
  const paymentIds = parts.payments.map((payment) => payment.id);

  counted(ctx);
  const movements = await ctx.tx.stockMovement.findMany({ where: { saleLineId: { in: lineIds } } });

  counted(ctx);
  const customerLedger = await ctx.tx.customerLedgerEntry.findMany({
    where: { OR: [{ saleId }, ...(paymentIds.length > 0 ? [{ salePaymentId: { in: paymentIds } }] : [])] },
  });

  let accountLedger: AccountLedgerEntry[] = [];
  if (paymentIds.length > 0) {
    counted(ctx);
    accountLedger = await ctx.tx.accountLedgerEntry.findMany({ where: { salePaymentId: { in: paymentIds } } });
  }
  return { movements, customerLedger, accountLedger };
}

/** A payment received later: the payment, the customer's PAYMENT entry, the account entry, and the sale's new paidKobo. */
export interface LaterPaymentWrite {
  saleId: string;
  payment: SalePayment;
  customerLedgerEntry: CustomerLedgerEntry | null;
  accountEntry: AccountLedgerEntry;
  newPaidKobo: bigint;
}

export async function insertLaterPayment(ctx: TxContext, write: LaterPaymentWrite) {
  const { tx } = ctx;

  counted(ctx);
  await tx.salePayment.create({
    data: {
      id: write.payment.id,
      saleId: write.saleId,
      accountId: write.payment.accountId,
      amountKobo: write.payment.amountKobo,
      paidAt: write.payment.paidAt,
    },
  });

  if (write.customerLedgerEntry !== null) {
    const entry = write.customerLedgerEntry;
    counted(ctx);
    await tx.customerLedgerEntry.create({
      data: {
        id: entry.id,
        customerId: entry.customerId,
        type: "PAYMENT",
        amountKobo: entry.amountKobo,
        // saleId stays null on purpose: ux_customer_ledger_sale_active allows one live row per sale.
        saleId: null,
        salePaymentId: entry.salePaymentId,
        occurredAt: entry.occurredAt,
      },
    });
  }

  counted(ctx);
  await tx.accountLedgerEntry.create({
    data: {
      id: write.accountEntry.id,
      accountId: write.accountEntry.accountId,
      type: "SALE_PAYMENT",
      amountKobo: write.accountEntry.amountKobo,
      salePaymentId: write.accountEntry.salePaymentId,
      occurredAt: write.accountEntry.occurredAt,
    },
  });

  counted(ctx);
  return tx.sale.update({ where: { id: write.saleId }, data: { paidKobo: write.newPaidKobo } });
}

export interface VoidWrite {
  saleId: string;
  reversalMovements: StockMovement[];
  reversalCustomerLedgerEntry: CustomerLedgerEntry | null;
  reversalAccountLedgerEntries: AccountLedgerEntry[];
}

/**
 * Writes the reversals in dependency order, then flips the sale to VOIDED.
 * `sales.paidKobo` is deliberately untouched (the document lock only lets
 * paidKobo, status and updatedAt change, and the money history stays visible);
 * reports must ignore the payments of VOIDED sales.
 */
export async function insertVoid(ctx: TxContext, write: VoidWrite) {
  const { tx } = ctx;

  const sorted = [...write.reversalMovements].sort(
    (a, b) =>
      (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0) ||
      (a.location < b.location ? -1 : a.location > b.location ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  if (sorted.length > 0) {
    counted(ctx);
    await tx.stockMovement.createMany({
      data: sorted.map((movement) => ({
        id: movement.id,
        productId: movement.productId,
        location: movement.location,
        type: "SALE" as const,
        quantityUnits: movement.quantityUnits,
        unitCostKobo: movement.unitCostKobo,
        saleLineId: movement.saleLineId,
        reversesEntryId: movement.reversesEntryId,
        occurredAt: movement.occurredAt,
      })),
    });
  }

  if (write.reversalCustomerLedgerEntry !== null) {
    const entry = write.reversalCustomerLedgerEntry;
    counted(ctx);
    await tx.customerLedgerEntry.create({
      data: {
        id: entry.id,
        customerId: entry.customerId,
        type: entry.type,
        amountKobo: entry.amountKobo,
        saleId: entry.saleId,
        salePaymentId: entry.salePaymentId,
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
        salePaymentId: entry.salePaymentId,
        reversesEntryId: entry.reversesEntryId,
        note: entry.note,
        occurredAt: entry.occurredAt,
      })),
    });
  }

  counted(ctx);
  return tx.sale.update({ where: { id: write.saleId }, data: { status: "VOIDED" } });
}
