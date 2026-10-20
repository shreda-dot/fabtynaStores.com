import { getLagosBusinessDate } from "@fabtyna/shared";
import type { CreateSaleDto } from "./sales.schemas.js";
import { validationError } from "../../lib/errors.js";

/** A device clock may run a little fast; anything further ahead is rejected. */
export const CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

export const MAX_LINES_PER_SALE = 200;
export const MAX_LINE_QUANTITY = 1_000_000;
/** 10 billion naira, in kobo. Keeps every sum far below BIGINT's range. */
export const MAX_UNIT_PRICE_KOBO = 10n ** 12n;
export const MAX_SALE_TOTAL_KOBO = 10n ** 15n;

/** References the server generates look like S-20261020-000123. */
const GENERATED_REFERENCE_PATTERN = /^S-\d{8}-\d{6,}$/;

export function isGeneratedReferenceShape(reference: string): boolean {
  return GENERATED_REFERENCE_PATTERN.test(reference);
}

export function formatSaleReference(soldAt: Date, sequence: bigint): string {
  const day = getLagosBusinessDate(soldAt).replaceAll("-", "");
  return `S-${day}-${sequence.toString().padStart(6, "0")}`;
}

export function assertSoldAtNotInFuture(soldAt: Date, now: Date): void {
  if (soldAt.getTime() > now.getTime() + CLOCK_TOLERANCE_MS) {
    throw validationError("The sale date cannot be in the future.", {
      field: "soldAt",
      soldAt: soldAt.toISOString(),
    });
  }
}

/** Empty or blank references mean "generate one"; look-alikes of generated ones are refused. */
export function normaliseClientReference(reference: string | null): string | null {
  const trimmed = reference?.trim() ?? "";
  if (trimmed === "") {
    return null;
  }
  if (isGeneratedReferenceShape(trimmed)) {
    throw validationError(
      "References that look like S-YYYYMMDD-000123 are reserved for the system. Leave the reference empty or choose another one.",
      { field: "reference" },
    );
  }
  return trimmed;
}

const LOCATIONS_BY_CHANNEL: Record<"RETAIL" | "WHOLESALE", readonly string[]> = {
  RETAIL: ["RETAIL_SHELF", "MARKET"],
  WHOLESALE: ["WAREHOUSE"],
};

/**
 * Retail is sold from the shelf or the market stall; wholesale from the
 * warehouse. This mirrors how the sales form picks the location (and how
 * `stockWorthByChannel` splits stock) — the domain itself has no such rule.
 */
export function assertLocationMatchesChannel(
  channel: CreateSaleDto["channel"],
  location: CreateSaleDto["location"],
): void {
  const allowed = LOCATIONS_BY_CHANNEL[channel];
  if (!allowed.includes(location)) {
    throw validationError(
      `A ${channel.toLowerCase()} sale cannot be taken from ${location}. Use ${allowed.join(" or ")}.`,
      { field: "location", channel, location, allowed },
    );
  }
}

/** Size limits that keep every amount inside BIGINT and NUMERIC(12,4). */
export function assertWithinBounds(dto: CreateSaleDto): void {
  if (dto.lines.length > MAX_LINES_PER_SALE) {
    throw validationError(`A sale may have at most ${MAX_LINES_PER_SALE} lines.`, { field: "lines" });
  }
  dto.lines.forEach((line, index) => {
    if (line.quantity > MAX_LINE_QUANTITY) {
      throw validationError(`Line ${index + 1}: quantity is too large.`, { field: `lines.${index}.quantity` });
    }
    if (BigInt(line.unitPriceKobo) > MAX_UNIT_PRICE_KOBO) {
      throw validationError(`Line ${index + 1}: unit price is too large.`, {
        field: `lines.${index}.unitPriceKobo`,
      });
    }
  });
  if (BigInt(dto.paidKobo) > MAX_SALE_TOTAL_KOBO) {
    throw validationError("The paid amount is too large.", { field: "paidKobo" });
  }
}
