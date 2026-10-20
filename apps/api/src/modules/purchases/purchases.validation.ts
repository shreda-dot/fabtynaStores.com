import { validationError } from "../../lib/errors.js";
import { MAX_LINE_QUANTITY, MAX_SALE_TOTAL_KOBO } from "../sales/sales.validation.js";
import type { CreatePurchaseDto } from "./purchases.schemas.js";

// Dates, clock tolerance, client-reference rules and generated-reference
// formatting are shared with sales (sales.validation.ts); only the size limits
// of a purchase live here.
export const MAX_LINES_PER_PURCHASE = 200;
export const MAX_PURCHASE_TOTAL_KOBO = MAX_SALE_TOTAL_KOBO;

/** Size limits that keep every amount inside BIGINT and NUMERIC(12,4). */
export function assertPurchaseWithinBounds(dto: CreatePurchaseDto): void {
  if (dto.lines.length > MAX_LINES_PER_PURCHASE) {
    throw validationError(`A purchase may have at most ${MAX_LINES_PER_PURCHASE} lines.`, { field: "lines" });
  }
  let total = 0n;
  dto.lines.forEach((line, index) => {
    if (line.quantity > MAX_LINE_QUANTITY) {
      throw validationError(`Line ${index + 1}: quantity is too large.`, { field: `lines.${index}.quantity` });
    }
    const lineTotal = BigInt(line.lineTotalKobo);
    if (lineTotal > MAX_PURCHASE_TOTAL_KOBO) {
      throw validationError(`Line ${index + 1}: the line total is too large.`, {
        field: `lines.${index}.lineTotalKobo`,
      });
    }
    total += lineTotal;
  });
  if (total > MAX_PURCHASE_TOTAL_KOBO) {
    throw validationError("The purchase total is too large.", { field: "lines" });
  }
  if (BigInt(dto.amountPaidNowKobo) > MAX_PURCHASE_TOTAL_KOBO) {
    throw validationError("The paid amount is too large.", { field: "amountPaidNowKobo" });
  }
}
