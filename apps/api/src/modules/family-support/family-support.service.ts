import { randomUUID } from "node:crypto";
import {
  assertNotFutureOccurredAt,
  buildAccountLedgerEntry,
  drawingReport,
  formatNaira,
  getLagosBusinessDate,
  getLagosBusinessDayRange,
  type CreateDrawingInput,
  type DrawingReportFilter,
} from "@fabtyna/shared";
import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import type { Actor } from "../../auth/actor.js";
import { AppError, businessRuleError, validationError } from "../../lib/errors.js";
import { hashRequestBody } from "../../lib/idempotency.js";
import { lockAccounts } from "../../lib/locks.js";
import { counted, createWriteRunner, insertAuditLog, type TxContext } from "../../lib/tx.js";
import type { TxTimeouts } from "../../lib/tx-options.js";

type MemberInput = { name: string; relationship: string };

export function createFamilySupportService(options: {
  prisma: PrismaClient;
  now?: () => Date;
  log?: (entry: Record<string, unknown>) => void;
  txTimeouts?: TxTimeouts;
}) {
  const now = options.now ?? (() => new Date());
  const runner = createWriteRunner({ ...options, now });

  function write(
    route: string,
    actor: Actor,
    key: string | null,
    body: unknown,
    operation: (ctx: TxContext) => Promise<{ status: number; body: Prisma.InputJsonValue; entityId: string; entityType: string; action: string; before?: Prisma.InputJsonValue }>,
  ) {
    return runner.runWrite(route, {}, (ctx) =>
      runner.withIdempotency(ctx, { actorId: actor.id, route, key, requestHash: hashRequestBody(body) }, async () => {
        const result = await operation(ctx);
        await insertAuditLog(ctx, result.entityType, {
          actorId: actor.id,
          action: result.action,
          entityId: result.entityId,
          beforeData: result.before,
          afterData: result.body,
          metadata: {},
        });
        return { status: result.status, body: result.body };
      }),
    );
  }

  async function lockMember(ctx: TxContext, id: string) {
    counted(ctx);
    const rows = await ctx.tx.$queryRaw<Array<{ id: string; name: string; relationship: string; isActive: boolean }>>`
      SELECT id, name, relationship, "isActive" FROM family_members WHERE id = ${id} FOR UPDATE`;
    const member = rows[0];
    if (!member) throw new AppError(404, "NOT_FOUND", "Beneficiary not found.", { id });
    return member;
  }

  return {
    async findDrawingEntry(id: string) {
      const drawing = await options.prisma.drawing.findUnique({ where: { id }, select: { entryId: true } });
      if (!drawing) throw new AppError(404, "NOT_FOUND", "Drawing not found.", { id });
      return drawing;
    },
    listMembers: () => options.prisma.familyMember.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, relationship: true, isActive: true },
    }),

    createMember(input: MemberInput, actor: Actor, key: string | null) {
      return write("POST /family-members", actor, key, input, async (ctx) => {
        counted(ctx);
        const member = await ctx.tx.familyMember.create({
          data: { name: input.name, normalizedKey: input.name.toLowerCase(), relationship: input.relationship },
          select: { id: true, name: true, relationship: true, isActive: true },
        });
        return { status: 201, body: member, entityId: member.id, entityType: "FamilyMember", action: "FAMILY_MEMBER_CREATED" };
      });
    },

    updateMember(id: string, input: MemberInput, actor: Actor, key: string | null) {
      return write(`PATCH /family-members/${id}`, actor, key, input, async (ctx) => {
        const before = await lockMember(ctx, id);
        counted(ctx);
        const member = await ctx.tx.familyMember.update({
          where: { id },
          data: { name: input.name, normalizedKey: input.name.toLowerCase(), relationship: input.relationship },
          select: { id: true, name: true, relationship: true, isActive: true },
        });
        return { status: 200, body: member, before, entityId: id, entityType: "FamilyMember", action: "FAMILY_MEMBER_UPDATED" };
      });
    },

    setMemberActive(id: string, isActive: boolean, actor: Actor, key: string | null) {
      return write(`POST /family-members/${id}/${isActive ? "reactivate" : "deactivate"}`, actor, key, { isActive }, async (ctx) => {
        const before = await lockMember(ctx, id);
        if (before.isActive === isActive) throw businessRuleError("Beneficiary is already in that state.");
        counted(ctx);
        const member = await ctx.tx.familyMember.update({
          where: { id }, data: { isActive }, select: { id: true, name: true, relationship: true, isActive: true },
        });
        return { status: 200, body: member, before, entityId: id, entityType: "FamilyMember", action: isActive ? "FAMILY_MEMBER_REACTIVATED" : "FAMILY_MEMBER_DEACTIVATED" };
      });
    },

    createDrawing(input: CreateDrawingInput, actor: Actor, key: string | null) {
      return write("POST /drawings", actor, key, input, async (ctx) => {
        const member = await lockMember(ctx, input.beneficiaryId);
        if (!member.isActive) throw businessRuleError("Select an active beneficiary.");
        const account = (await lockAccounts(ctx, [input.accountId])).get(input.accountId);
        if (!account) throw new AppError(404, "NOT_FOUND", "Account not found.", { accountId: input.accountId });
        if (!account.isActive || account.isHolding || (account.type !== "CASH" && account.type !== "BANK")) {
          throw businessRuleError("Select an active cash or bank account.");
        }
        const occurredAt = new Date(input.occurredAt);
        try {
          assertNotFutureOccurredAt(occurredAt, getLagosBusinessDate(now()));
        } catch (error) {
          if (error instanceof RangeError) throw businessRuleError(error.message);
          throw error;
        }
        const amount = BigInt(input.amountKobo);
        if (account.balanceKobo < amount) {
          throw businessRuleError(`Cannot spend ${formatNaira(amount)} from ${account.name} (balance ${formatNaira(account.balanceKobo)}): record income or reconcile first.`, {
            accountId: account.id, balanceKobo: account.balanceKobo.toString(), amountKobo: amount.toString(),
          });
        }
        const entry = buildAccountLedgerEntry({
          accountId: account.id,
          type: "OWNER_DRAWING",
          amountKobo: -amount,
          note: input.note || `Owner drawing: ${input.purpose.replaceAll("_", " ")}`,
          occurredAt,
        }, randomUUID);
        counted(ctx);
        await ctx.tx.accountLedgerEntry.create({ data: entry });
        counted(ctx);
        const drawing = await ctx.tx.drawing.create({
          data: { entryId: entry.id, beneficiaryId: member.id, purpose: input.purpose, createdById: actor.id },
          select: { id: true },
        });
        const after = {
          id: drawing.id, entryId: entry.id, beneficiaryId: member.id, purpose: input.purpose,
          accountId: account.id, amountKobo: input.amountKobo, occurredAt: occurredAt.toISOString(), note: input.note,
        };
        return { status: 201, body: after, entityId: drawing.id, entityType: "Drawing", action: "DRAWING_RECORDED" };
      });
    },

    async listDrawings(filter: DrawingReportFilter) {
      let start: Date;
      let end: Date;
      try {
        start = getLagosBusinessDayRange(filter.from).start;
        end = getLagosBusinessDayRange(filter.to).end;
      } catch (error) {
        if (error instanceof RangeError) throw validationError(error.message);
        throw error;
      }
      if (start >= end) throw businessRuleError("From date must be on or before to date.");
      const rows = await options.prisma.drawing.findMany({
        where: {
          ...(filter.beneficiaryId ? { beneficiaryId: filter.beneficiaryId } : {}),
          ...(filter.purpose ? { purpose: filter.purpose } : {}),
          ...(filter.accountId ? { entry: { accountId: filter.accountId } } : {}),
          OR: [
            { sourceExpenseId: null, entry: { occurredAt: { gte: start, lt: end } } },
            { sourceExpense: { is: { expenseDate: { gte: start, lt: end } } } },
          ],
        },
        include: {
          beneficiary: true,
          sourceExpense: { select: { expenseDate: true } },
          entry: { include: { account: true, reversedBy: { select: { id: true } } } },
        },
      });
      const data = rows.map((row) => ({
        id: row.id, entryId: row.entryId, beneficiaryId: row.beneficiaryId, beneficiaryName: row.beneficiary.name,
        purpose: row.purpose, accountId: row.entry.accountId, accountName: row.entry.account.name,
        amountKobo: -row.entry.amountKobo, occurredAt: row.sourceExpense?.expenseDate ?? row.entry.occurredAt,
        postedAt: row.entry.occurredAt,
        note: row.entry.note, reversed: row.entry.reversedBy.length > 0, sourceExpenseId: row.sourceExpenseId,
      })).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id.localeCompare(a.id));
      const report = drawingReport(data, filter);
      const total = (row: { id: string; name: string; amountKobo: bigint; count: number }) => ({ ...row, amountKobo: row.amountKobo.toString() });
      return {
        items: data.map((row) => ({
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
}
