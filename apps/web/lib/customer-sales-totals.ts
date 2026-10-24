import { saleBalanceDueKobo } from "./api/sales.api";

export type SaleForTotals = {
  status: string;
  totalKobo: string;
  paidKobo: string;
  balanceDueKobo?: string;
};

export type CustomerSalesTotals = {
  count: number;
  billedKobo: bigint;
  paidKobo: bigint;
  owedKobo: bigint;
};

/** Exact totals (bigint kobo) for a customer's sales. Voided sales are never counted. */
export function sumCustomerSales(sales: readonly SaleForTotals[]): CustomerSalesTotals {
  let count = 0;
  let billed = 0n;
  let paid = 0n;
  let owed = 0n;
  for (const sale of sales) {
    if (sale.status === "VOIDED") continue;
    count += 1;
    billed += BigInt(sale.totalKobo);
    paid += BigInt(sale.paidKobo);
    owed += saleBalanceDueKobo(sale);
  }
  return { count, billedKobo: billed, paidKobo: paid, owedKobo: owed };
}

const DAY_MS = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written as YYYY-MM-DD. */
export function isBusinessDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Number of days from `from` to `to`, counting both ends. */
export function inclusiveDays(from: string, to: string): number {
  const span = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(span / DAY_MS) + 1;
}

export type PeriodPreset = "today" | "yesterday" | "week" | "month" | "last30";

/** Presets work on Lagos business dates (YYYY-MM-DD). "week" runs Monday to today. */
export function presetRange(preset: PeriodPreset, today: string): { from: string; to: string } {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const day = addDays(today, -1);
      return { from: day, to: day };
    }
    case "week": {
      const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
      return { from: addDays(today, -((weekday + 6) % 7)), to: today };
    }
    case "month":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "last30":
      return { from: addDays(today, -29), to: today };
  }
}

/** A plain-language problem with the chosen period, or null when it is fine. */
export function validatePeriod(
  from: string,
  to: string,
  today: string,
  maxDays = 366,
): string | null {
  if (!isBusinessDate(from) || !isBusinessDate(to)) return "Choose both dates.";
  if (from > to) return "The start date must not be after the end date.";
  if (to > today) return "The end date cannot be in the future.";
  if (inclusiveDays(from, to) > maxDays) return `Choose a period of at most ${maxDays} days.`;
  return null;
}