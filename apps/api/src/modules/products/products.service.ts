import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import type { Actor } from "../../auth/actor.js";
import { AppError, businessRuleError } from "../../lib/errors.js";
import { hashRequestBody } from "../../lib/idempotency.js";
import { createWriteRunner, counted, insertAuditLog } from "../../lib/tx.js";
import type { TxTimeouts } from "../../lib/tx-options.js";
import { getProductDetail, listProducts } from "./products.queries.js";
import type { CreateProductBody, ListProductsQuery, PatchProductBody } from "./products.schemas.js";

export interface ProductsServiceOptions {
  prisma: PrismaClient;
  now?: () => Date;
  log?: (entry: Record<string, unknown>) => void;
  txTimeouts?: TxTimeouts;
}

function dto(product: {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  packName: string;
  unitsPerPack: number;
  saleChannel: string;
  retailPriceKobo: bigint;
  wholesalePriceKobo: bigint;
  averageCostKobo: bigint;
  reorderLevelUnits: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...product,
    active: product.deletedAt === null,
    retailPriceKobo: product.retailPriceKobo.toString(),
    wholesalePriceKobo: product.wholesalePriceKobo.toString(),
    averageCostKobo: product.averageCostKobo.toString(),
    deletedAt: product.deletedAt?.toISOString() ?? null,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

export function createProductsService(options: ProductsServiceOptions) {
  const now = options.now ?? (() => new Date());
  const runner = createWriteRunner({
    prisma: options.prisma,
    now,
    log: options.log,
    txTimeouts: options.txTimeouts,
  });

  return {
    list(query: ListProductsQuery) {
      return listProducts(options.prisma, query);
    },
    detail(id: string) {
      return getProductDetail(options.prisma, id);
    },
    async create(input: CreateProductBody, actor: Actor, key: string | null) {
      const route = "POST /products";
      return runner.runWrite(route, {}, async (ctx) =>
        runner.withIdempotency(ctx, { route, key, requestHash: hashRequestBody(input) }, async () => {
          if (input.sku !== null) {
            counted(ctx);
            const duplicate = await ctx.tx.product.findFirst({
              where: { sku: input.sku, deletedAt: null },
              select: { id: true },
            });
            if (duplicate !== null) throw businessRuleError("An active product already uses this SKU.", { sku: input.sku });
          }
          counted(ctx);
          const product = await ctx.tx.product.create({
            data: {
              name: input.name,
              sku: input.sku,
              category: input.category,
              packName: input.packName,
              unitsPerPack: input.unitsPerPack,
              saleChannel: input.saleChannel,
              retailPriceKobo: BigInt(input.retailPriceKobo),
              wholesalePriceKobo: BigInt(input.wholesalePriceKobo),
              reorderLevelUnits: input.reorderLevelUnits,
            },
          });
          const after = dto(product);
          await insertAuditLog(ctx, "Product", {
            actorId: actor.id,
            action: "PRODUCT_CREATED",
            entityId: product.id,
            afterData: after as Prisma.InputJsonValue,
            metadata: {},
          });
          return { status: 201, body: after };
        }),
      );
    },
    async patch(id: string, input: PatchProductBody, actor: Actor, key: string | null) {
      const route = `PATCH /products/${id}`;
      return runner.runWrite(route, { productId: id }, async (ctx) =>
        runner.withIdempotency(ctx, { route, key, requestHash: hashRequestBody(input) }, async () => {
          counted(ctx);
          const locked = await ctx.tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM products WHERE id = ${id} FOR UPDATE`;
          if (locked.length === 0) throw new AppError(404, "NOT_FOUND", "Product not found.", { id });
          counted(ctx);
          const before = await ctx.tx.product.findUnique({ where: { id } });
          if (before === null) throw new AppError(404, "NOT_FOUND", "Product not found.", { id });
          if (input.unitsPerPack !== undefined && input.unitsPerPack !== before.unitsPerPack) {
            counted(ctx);
            const hasMovement = await ctx.tx.stockMovement.findFirst({ where: { productId: id }, select: { id: true } });
            if (hasMovement !== null) {
              throw businessRuleError("Pack size cannot change after this product has a stock movement.", { productId: id });
            }
          }
          if (input.sku !== undefined && input.sku !== null) {
            counted(ctx);
            const duplicate = await ctx.tx.product.findFirst({
              where: { sku: input.sku, deletedAt: null, id: { not: id } },
              select: { id: true },
            });
            if (duplicate !== null) throw businessRuleError("An active product already uses this SKU.", { sku: input.sku });
          }
          const data: Prisma.ProductUpdateInput = {};
          if (input.name !== undefined) data.name = input.name;
          if (input.sku !== undefined) data.sku = input.sku;
          if (input.category !== undefined) data.category = input.category;
          if (input.packName !== undefined) data.packName = input.packName;
          if (input.unitsPerPack !== undefined) data.unitsPerPack = input.unitsPerPack;
          if (input.saleChannel !== undefined) data.saleChannel = input.saleChannel;
          if (input.retailPriceKobo !== undefined) data.retailPriceKobo = BigInt(input.retailPriceKobo);
          if (input.wholesalePriceKobo !== undefined) data.wholesalePriceKobo = BigInt(input.wholesalePriceKobo);
          if (input.reorderLevelUnits !== undefined) data.reorderLevelUnits = input.reorderLevelUnits;
          counted(ctx);
          const product = await ctx.tx.product.update({ where: { id }, data });
          const beforeDto = dto(before);
          const after = dto(product);
          await insertAuditLog(ctx, "Product", {
            actorId: actor.id,
            action: "PRODUCT_UPDATED",
            entityId: id,
            beforeData: beforeDto as Prisma.InputJsonValue,
            afterData: after as Prisma.InputJsonValue,
            metadata: {},
          });
          return { status: 200, body: after };
        }),
      );
    },
    async setActive(id: string, active: boolean, actor: Actor, key: string | null) {
      const suffix = active ? "reactivate" : "deactivate";
      const route = `POST /products/${id}/${suffix}`;
      return runner.runWrite(route, { productId: id }, async (ctx) =>
        runner.withIdempotency(ctx, { route, key, requestHash: hashRequestBody({ active }) }, async () => {
          counted(ctx);
          const locked = await ctx.tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM products WHERE id = ${id} FOR UPDATE`;
          if (locked.length === 0) throw new AppError(404, "NOT_FOUND", "Product not found.", { id });
          counted(ctx);
          const before = await ctx.tx.product.findUnique({ where: { id } });
          if (before === null) throw new AppError(404, "NOT_FOUND", "Product not found.", { id });
          if ((before.deletedAt === null) === active) {
            throw businessRuleError(active ? "This product is already active." : "This product is already inactive.", { productId: id });
          }
          if (active && before.sku !== null) {
            counted(ctx);
            const duplicate = await ctx.tx.product.findFirst({
              where: { sku: before.sku, deletedAt: null, id: { not: id } },
              select: { id: true },
            });
            if (duplicate !== null) {
              throw businessRuleError("This product cannot be reactivated because another active product uses its SKU.", {
                productId: id,
                sku: before.sku,
              });
            }
          }
          counted(ctx);
          const balances = await ctx.tx.stockBalance.findMany({ where: { productId: id }, orderBy: { location: "asc" } });
          const stockUnits = balances.reduce((sum, row) => sum + row.quantityUnits, 0);
          counted(ctx);
          const product = await ctx.tx.product.update({
            where: { id },
            data: { deletedAt: active ? null : now() },
          });
          const beforeDto = dto(before);
          const after = { ...dto(product), stockUnits };
          await insertAuditLog(ctx, "Product", {
            actorId: actor.id,
            action: active ? "PRODUCT_REACTIVATED" : "PRODUCT_DEACTIVATED",
            entityId: id,
            beforeData: beforeDto as Prisma.InputJsonValue,
            afterData: after as Prisma.InputJsonValue,
            metadata: {},
          });
          return { status: 200, body: after };
        }),
      );
    },
  };
}
