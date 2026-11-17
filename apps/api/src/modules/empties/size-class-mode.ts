import { businessRuleError } from "../../lib/errors.js";
import { counted, type TxContext } from "../../lib/tx.js";

export type SizeClassPhase = "LEGACY" | "RECOUNT_PENDING" | "READY";

export async function lockSizeClassPhase(ctx: TxContext): Promise<SizeClassPhase> {
  counted(ctx);
  const rows = await ctx.tx.$queryRaw<Array<{ phase: SizeClassPhase }>>`
    SELECT phase FROM empties_size_class_mode WHERE id = 1 FOR SHARE`;
  if (rows.length !== 1) throw new Error("The empties size-class mode is missing.");
  return rows[0]!.phase;
}

export function assertSalesAvailable(phase: SizeClassPhase): void {
  if (phase === "RECOUNT_PENDING") {
    throw businessRuleError("Sales and sale voids are paused while empties are being recounted.");
  }
}

export async function assertPurchasesAvailable(
  ctx: TxContext,
  phase: SizeClassPhase,
  productIds: readonly string[],
): Promise<void> {
  if (phase === "LEGACY") return;
  counted(ctx);
  const rows = await ctx.tx.purchaseEmptiesProduct.findMany({
    where: { productId: { in: [...new Set(productIds)] }, classification: "RETURNABLE" },
    select: { productId: true },
  });
  if (rows.length === 0) return;
  if (phase === "RECOUNT_PENDING") {
    throw businessRuleError("Purchases of returnable products are paused until the empties recount is confirmed.");
  }
}

export function assertPurchaseVoidAvailable(phase: SizeClassPhase): void {
  if (phase === "RECOUNT_PENDING") {
    throw businessRuleError("Purchase voids are paused while empties are being recounted.");
  }
}
