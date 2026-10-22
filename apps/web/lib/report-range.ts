/** Report queries stay fresh this long so tab switches do not refetch. */
export const REPORT_STALE_MS = 60_000;

/** Same inclusive day count and cap as the API's resolveListDateRange. */
export const MAX_REPORT_RANGE_DAYS = 366;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function inclusiveDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

/** Returns a friendly message, or null when the range may be sent. */
export function validateReportRange(from: string, to: string): string | null {
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) {
    return "Choose a valid date range.";
  }
  if (from > to) return "“From” must not be after “To”.";
  const days = inclusiveDays(from, to);
  if (days > MAX_REPORT_RANGE_DAYS) {
    return `Date range cannot exceed ${MAX_REPORT_RANGE_DAYS} days (you chose ${days}). Narrow the range and try again.`;
  }
  return null;
}
