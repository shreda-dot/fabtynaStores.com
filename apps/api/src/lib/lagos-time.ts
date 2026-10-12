const LAGOS_TIME_ZONE = "Africa/Lagos";

function dateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LAGOS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

export function getLagosBusinessDate(now = new Date()): string {
  const { year, month, day } = dateParts(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getLagosBusinessDayRange(
  businessDate: string,
): { start: Date; end: Date } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(businessDate);
  if (!match) {
    throw new RangeError("Business date must use YYYY-MM-DD format.");
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const localCalendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    localCalendarDate.getUTCFullYear() !== year ||
    localCalendarDate.getUTCMonth() !== month - 1 ||
    localCalendarDate.getUTCDate() !== day
  ) {
    throw new RangeError("Business date is not a valid calendar date.");
  }

  // Lagos uses UTC+01:00 year-round. Construct both local midnights explicitly
  // so business-day boundaries never depend on the host's timezone or UTC date.
  const start = new Date(`${businessDate}T00:00:00+01:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}
