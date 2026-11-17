import type { PrismaClient } from "../../../generated/prisma/client.js";
import type { Actor } from "../../auth/actor.js";
import { AppError, businessRuleError, validationError } from "../../lib/errors.js";
import { hashRequestBody } from "../../lib/idempotency.js";
import { counted, createWriteRunner, insertAuditLog, type WriteResponse } from "../../lib/tx.js";
import type { TxTimeouts } from "../../lib/tx-options.js";
import type { PurchaseEmptiesSetupBody, PurchaseEmptiesSetupListQuery } from "./empties.schemas.js";

type Kind = "CRATE" | "BOTTLE";
type Classification = "RETURNABLE" | "NON_RETURNABLE";

interface ProductRow {
  productId: string;
  productName: string;
  sku: string | null;
  unitsPerPack: number;
  isActive: boolean;
  ownerId: string | null;
  ownerName: string | null;
  ownerIsActive: boolean | null;
  classification: Classification | null;
}

interface PurchaseMapping {
  productId: string;
  typeId: string;
  kind: Kind;
  label: string;
  countPerUnit: number | null;
  countPerPack: number | null;
  cratesPerPack: number | null;
  capacity: number | null;
}

interface SaleMapping {
  productId: string;
  typeId: string;
  kind: Kind;
  label: string;
  retailQuantityPerUnit: number;
  wholesaleQuantityPerPack: number;
}

export function createPurchaseEmptiesSetupService(options: {
  prisma: PrismaClient;
  now?: () => Date;
  log?: (entry: Record<string, unknown>) => void;
  txTimeouts?: TxTimeouts;
}) {
  const runner = createWriteRunner({
    prisma: options.prisma,
    now: options.now ?? (() => new Date()),
    log: options.log,
    txTimeouts: options.txTimeouts,
  });

  return {
    async listPurchaseEmptiesSetup(query: PurchaseEmptiesSetupListQuery) {
      const rows = await options.prisma.$queryRaw<ProductRow[]>`
        SELECT p.id AS "productId", p.name AS "productName", p.sku, p."unitsPerPack",
               (p."deletedAt" IS NULL) AS "isActive", po."ownerId", o.name AS "ownerName",
               o."isActive" AS "ownerIsActive", c.classification::text AS classification
          FROM products p
          LEFT JOIN empties_product_owners po ON po."productId" = p.id
          LEFT JOIN empties_owners o ON o.id = po."ownerId"
          LEFT JOIN purchase_empties_products c ON c."productId" = p.id
         WHERE (${query.cursor ?? null}::text IS NULL OR p.id > ${query.cursor ?? null})
         ORDER BY p.id
         LIMIT ${query.limit + 1}`;
      const page = rows.slice(0, query.limit);
      const ids = page.map((row) => row.productId);
      const [mappings, suggestions] = ids.length === 0 ? [[], []] : await Promise.all([
        options.prisma.$queryRaw<PurchaseMapping[]>`
          SELECT p."productId", p."typeId", p.kind::text AS kind, t.label,
                 p."countPerUnit", p."countPerPack", p."cratesPerPack", t.capacity
            FROM purchase_empties_packaging p JOIN empties_types t ON t.id = p."typeId"
           WHERE p."productId" = ANY(${ids}::text[])
           ORDER BY p."productId", p.kind`,
        options.prisma.$queryRaw<SaleMapping[]>`
          SELECT p."productId", p."typeId", p.kind::text AS kind, t.label,
                 p."retailQuantityPerUnit", p."wholesaleQuantityPerPack"
            FROM empties_product_packaging p JOIN empties_types t ON t.id = p."typeId"
           WHERE p."productId" = ANY(${ids}::text[])
           ORDER BY p."productId", p.kind`,
      ]);
      return {
        items: page.map((row) => ({
          ...row,
          mappings: mappings.filter((mapping) => mapping.productId === row.productId),
          salePackagingSuggestions: suggestions.filter((mapping) => mapping.productId === row.productId),
        })),
        nextCursor: rows.length > query.limit ? page[page.length - 1]!.productId : null,
      };
    },

    async setPurchaseEmptiesSetup(
      productId: string,
      input: PurchaseEmptiesSetupBody,
      actor: Actor,
      key: string | null,
    ): Promise<WriteResponse> {
      const route = `PUT /empties/products/${productId}/purchase-setup`;
      return runner.runWrite(route, { productId }, (ctx) =>
        runner.withIdempotency(
          ctx,
          { actorId: actor.id, route, key, requestHash: hashRequestBody(input) },
          async () => {
            counted(ctx);
            const products = await ctx.tx.$queryRaw<Array<{ id: string; name: string; ownerId: string | null }>>`
              SELECT p.id, p.name, po."ownerId"
                FROM products p LEFT JOIN empties_product_owners po ON po."productId" = p.id
               WHERE p.id = ${productId}
               FOR UPDATE OF p`;
            const product = products[0];
            if (!product) throw new AppError(404, "NOT_FOUND", "Product not found.", { productId });
            if (input.mappings.length > 0 && product.ownerId === null) {
              throw businessRuleError("Assign this product to a brewery before setting up its purchase containers.");
            }
            if (product.ownerId !== null && input.mappings.length > 0) {
              counted(ctx);
              const owners = await ctx.tx.$queryRaw<Array<{ isActive: boolean }>>`
                SELECT "isActive" FROM empties_owners WHERE id = ${product.ownerId} FOR SHARE`;
              if (!owners[0]?.isActive) {
                throw businessRuleError("Reactivate this product's brewery before setting up its purchase containers.");
              }
            }
            const typeIds = input.mappings.map((mapping) => mapping.typeId);
            if (typeIds.length > 0) counted(ctx);
            const types = typeIds.length === 0 ? [] : await ctx.tx.$queryRaw<Array<{
              id: string; ownerId: string; kind: Kind; isActive: boolean; label: string;
              capacity: number | null;
            }>>`
              SELECT id, "ownerId", kind::text AS kind, "isActive", label, capacity FROM empties_types
               WHERE id = ANY(${typeIds}::text[]) ORDER BY id FOR SHARE`;
            const typeById = new Map(types.map((type) => [type.id, type]));
            for (const mapping of input.mappings) {
              const type = typeById.get(mapping.typeId);
              if (!type || type.ownerId !== product.ownerId || type.kind !== mapping.kind) {
                throw validationError("Choose a matching container type owned by this product's brewery.", {
                  typeId: mapping.typeId, kind: mapping.kind,
                });
              }
              if (!type.isActive) {
                throw businessRuleError(`Reactivate '${type.label}' before using it for purchases.`, { typeId: type.id });
              }
              if (type.capacity !== null
                  && (mapping.kind !== "BOTTLE" || mapping.countPerUnit !== 1)) {
                throw validationError("A size-class purchase mapping must use its brewery's bottle type and count one bottle per product unit.", {
                  typeId: type.id,
                  capacity: type.capacity,
                });
              }
              if (type.capacity === null && mapping.kind === "BOTTLE" && mapping.cratesPerPack != null) {
                throw validationError("Only a sized bottle type can have crates per product pack.", { typeId: type.id });
              }
            }

            counted(ctx);
            const before = await ctx.tx.purchaseEmptiesProduct.findUnique({
              where: { productId },
              select: { classification: true },
            });
            counted(ctx);
            const beforeMappings = await ctx.tx.purchaseEmptiesPackaging.findMany({
              where: { productId },
              select: { kind: true, typeId: true, countPerUnit: true, countPerPack: true, cratesPerPack: true },
              orderBy: { kind: "asc" },
            });
            const mappingsChanged = beforeMappings.length !== input.mappings.length
              || beforeMappings.some((old) => !input.mappings.some((next) =>
                old.kind === next.kind && old.typeId === next.typeId
                && old.countPerUnit === (next.kind === "BOTTLE" ? next.countPerUnit : null)
                && old.countPerPack === (next.kind === "CRATE" ? next.countPerPack : null)
                && old.cratesPerPack === (next.kind === "BOTTLE" ? next.cratesPerPack ?? null : null)));
            if (mappingsChanged) {
              counted(ctx);
              await ctx.tx.purchaseEmptiesPackaging.deleteMany({ where: { productId } });
            }
            counted(ctx);
            await ctx.tx.purchaseEmptiesProduct.upsert({
              where: { productId },
              create: { productId, classification: input.classification },
              update: { classification: input.classification },
            });
            if (mappingsChanged && input.mappings.length > 0 && product.ownerId !== null) {
              const ownerId = product.ownerId;
              counted(ctx);
              await ctx.tx.purchaseEmptiesPackaging.createMany({
                data: input.mappings.map((mapping) => ({
                  productId, ownerId, typeId: mapping.typeId, kind: mapping.kind,
                  countPerUnit: mapping.kind === "BOTTLE" ? mapping.countPerUnit : null,
                  countPerPack: mapping.kind === "CRATE" ? mapping.countPerPack : null,
                  cratesPerPack: mapping.kind === "BOTTLE" ? mapping.cratesPerPack ?? null : null,
                })),
              });
            }
            const after = { productId, productName: product.name, classification: input.classification, mappings: input.mappings };
            await insertAuditLog(ctx, "Product", {
              actorId: actor.id,
              action: "PURCHASE_EMPTIES_SETUP_CHANGED",
              entityId: productId,
              beforeData: { classification: before?.classification ?? null, mappings: beforeMappings },
              afterData: after,
              metadata: { idempotencyKey: key, actorEmail: actor.email },
            });
            return { status: 200, body: after };
          },
        ),
      );
    },
  };
}
