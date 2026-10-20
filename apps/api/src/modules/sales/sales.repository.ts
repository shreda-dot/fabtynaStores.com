import type { Prisma, PrismaClient } from "../../../generated/prisma/client.js";
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

export interface TxContext {
  tx: Prisma.TransactionClient;
  /** Counts database round trips so the service can log them. */
  queries: { count: number };
}

function counted(ctx: TxContext): void {
  ctx.queries.count += 1;
}

/** `SET LOCAL` only: it ends with the transaction, so it is safe on any connection. */
export async function setLocalTimeouts(ctx: TxContext): Promise<void> {
  counted(ctx);
  await ctx.tx.$executeRawUnsafe("SET LOCAL lock_timeout = '15s'");
}

interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  category: Product["category"];
  packName: string;
  unitsPerPack: number;
  saleChannel: Product["saleChannel"];
  retailPriceKobo: bigint;
  wholesalePriceKobo: bigint;
  averageCostKobo: bigint;
  reorderLevelUnits: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Locks the products being sold, in id order. Every sale takes product locks in
 * the same order, so two sales over overlapping products wait for each other
 * instead of deadlocking.
 */
export async function lockProducts(ctx: TxContext, productIds: readonly string[]): Promise<Product[]> {
  counted(ctx);
  const ids = [...new Set(productIds)].sort();
  const rows = await ctx.tx.$queryRaw<ProductRow[]>`
    SELECT id, name, sku, category, "packName", "unitsPerPack", "saleChannel",
           "retailPriceKobo", "wholesalePriceKobo", "averageCostKobo",
           "reorderLevelUnits", "deletedAt", "createdAt", "updatedAt"
      FROM products
     WHERE id = ANY(${ids}::text[])
     ORDER BY id
       FOR UPDATE`;
  return rows;
}

/**
 * Locks the stock balance rows of the products at the sale's location, ordered
 * by (productId, location). A product that has never moved has no row; it
 * counts as zero available.
 */
export async function lockStockBalances(
  ctx: TxContext,
  productIds: readonly string[],
  location: StockLocation,
): Promise<Map<string, number>> {
  counted(ctx);
  const ids = [...new Set(productIds)].sort();
  const rows = await ctx.tx.$queryRaw<Array<{ productId: string; units: number }>>`
    SELECT "productId", "quantityUnits"::int AS units
      FROM stock_balances
     WHERE "productId" = ANY(${ids}::text[])
       AND location = ${location}::"StockLocation"
     ORDER BY "productId", location
       FOR UPDATE`;
  return new Map(rows.map((row) => [row.productId, row.units]));
}

export async function findCustomerForSale(ctx: TxContext, customerId: string) {
  counted(ctx);
  return ctx.tx.customer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, type: true, deletedAt: true },
  });
}

export async function findAccountForSale(ctx: TxContext, accountId: string) {
  counted(ctx);
  return ctx.tx.account.findUnique({
    where: { id: accountId },
    select: { id: true, name: true, isActive: true },
  });
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

export async function findSaleById(prisma: PrismaClient, id: string) {
  return prisma.sale.findUnique({ where: { id } });
}
