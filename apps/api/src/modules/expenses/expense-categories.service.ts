import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import type { Actor } from "../../auth/actor.js";
import { businessRuleError, validationError } from "../../lib/errors.js";
import { hashRequestBody } from "../../lib/idempotency.js";
import {
  createWriteRunner,
  counted,
  insertAuditLog,
  type TxContext,
} from "../../lib/tx.js";
import type { TxTimeouts } from "../../lib/tx-options.js";
import type { z } from "zod";
import type {
  createExpenseCategorySchema,
  renameExpenseCategorySchema,
} from "./expense-categories.schemas.js";

type CategoryInput = z.infer<typeof createExpenseCategorySchema>;
type CategoryRow = {
  id: string;
  name: string;
  normalizedKey: string;
  code: string | null;
  isActive: boolean;
  createdAt: Date;
};

export interface ExpenseCategoryServiceOptions {
  prisma: PrismaClient;
  now?: () => Date;
  log?: (entry: Record<string, unknown>) => void;
  txTimeouts?: TxTimeouts;
}

const routeFor = (method: string, path: string): string => `${method} ${path}`;

function toCategoryDto(category: CategoryRow, expenseCount = 0) {
  return {
    id: category.id,
    name: category.name,
    code: category.code,
    isActive: category.isActive,
    createdAt: category.createdAt.toISOString(),
    expenseCount,
  };
}

function normalizeName(name: string): { name: string; normalizedKey: string } {
  const normalizedName = name.trim();
  if (normalizedName.length < 1 || normalizedName.length > 60) {
    throw validationError("Category names must be 1 to 60 characters.");
  }
  return { name: normalizedName, normalizedKey: normalizedName.toLowerCase() };
}

export function createExpenseCategoryService(options: ExpenseCategoryServiceOptions) {
  const runner = createWriteRunner({
    prisma: options.prisma,
    now: options.now ?? (() => new Date()),
    log: options.log,
    txTimeouts: options.txTimeouts,
  });

  async function lockCategory(ctx: TxContext, id: string) {
    counted(ctx);
    const rows = await ctx.tx.$queryRaw<CategoryRow[]>`
      SELECT id, name, "normalizedKey", code, "isActive", "createdAt"
        FROM expense_categories
       WHERE id = ${id}
       FOR UPDATE`;
    const category = rows[0];
    if (category === undefined) {
      throw validationError("Expense category not found.", { id });
    }
    return category;
  }

  return {
    async list(includeInactive: boolean) {
      const rows = await options.prisma.expenseCategory.findMany({
        where: includeInactive ? undefined : { isActive: true },
        include: { _count: { select: { expenses: true } } },
        orderBy: [{ code: "asc" }, { name: "asc" }, { id: "asc" }],
      });
      return rows.map(({ _count, ...category }) =>
        toCategoryDto(category, _count.expenses),
      );
    },

    async create(input: CategoryInput, actor: Actor, key: string | null) {
      const normalized = normalizeName(input.name);
      const route = routeFor("POST", "/expense-categories");
      return runner.runWrite(route, {}, async (ctx) =>
        runner.withIdempotency(ctx, { route, key, requestHash: hashRequestBody(input) }, async () => {
          counted(ctx);
          const category = await ctx.tx.expenseCategory.create({ data: normalized });
          const after = toCategoryDto(category);
          await insertAuditLog(ctx, "ExpenseCategory", {
            actorId: actor.id,
            action: "EXPENSE_CATEGORY_CREATED",
            entityId: category.id,
            afterData: after as Prisma.InputJsonValue,
            metadata: {},
          });
          return { status: 201, body: after };
        }),
      );
    },

    async rename(id: string, input: z.infer<typeof renameExpenseCategorySchema>, actor: Actor, key: string | null) {
      const normalized = normalizeName(input.name);
      const route = routeFor("PATCH", `/expense-categories/${id}`);
      return runner.runWrite(route, { categoryId: id }, async (ctx) =>
        runner.withIdempotency(ctx, { route, key, requestHash: hashRequestBody(input) }, async () => {
          const before = await lockCategory(ctx, id);
          if (before.code !== null) {
            throw businessRuleError("System expense categories cannot be renamed.", { categoryId: id });
          }
          counted(ctx);
          const category = await ctx.tx.expenseCategory.update({ where: { id }, data: normalized });
          const after = toCategoryDto(category);
          await insertAuditLog(ctx, "ExpenseCategory", {
            actorId: actor.id,
            action: "EXPENSE_CATEGORY_RENAMED",
            entityId: id,
            beforeData: toCategoryDto(before) as Prisma.InputJsonValue,
            afterData: after as Prisma.InputJsonValue,
            metadata: {},
          });
          return { status: 200, body: after };
        }),
      );
    },

    async setActive(id: string, isActive: boolean, actor: Actor, key: string | null) {
      const method = isActive ? "POST" : "POST";
      const suffix = isActive ? "reactivate" : "deactivate";
      const route = routeFor(method, `/expense-categories/${id}/${suffix}`);
      const body = { isActive };
      return runner.runWrite(route, { categoryId: id }, async (ctx) =>
        runner.withIdempotency(ctx, { route, key, requestHash: hashRequestBody(body) }, async () => {
          const before = await lockCategory(ctx, id);
          if (before.code !== null) {
            throw businessRuleError("System expense categories cannot be deactivated.", { categoryId: id });
          }
          if (before.isActive === isActive) {
            throw businessRuleError(
              isActive ? "This expense category is already active." : "This expense category is already inactive.",
              { categoryId: id },
            );
          }
          counted(ctx);
          const category = await ctx.tx.expenseCategory.update({ where: { id }, data: { isActive } });
          const after = toCategoryDto(category);
          await insertAuditLog(ctx, "ExpenseCategory", {
            actorId: actor.id,
            action: isActive ? "EXPENSE_CATEGORY_REACTIVATED" : "EXPENSE_CATEGORY_DEACTIVATED",
            entityId: id,
            beforeData: toCategoryDto(before) as Prisma.InputJsonValue,
            afterData: after as Prisma.InputJsonValue,
            metadata: {},
          });
          return { status: 200, body: after };
        }),
      );
    },
  };
}
