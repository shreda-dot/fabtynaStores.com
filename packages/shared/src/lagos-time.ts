const LAGOS_TIME_ZONE = "Africa/Lagos";
const LAGOS_OFFSET = "+01:00";
const LOCALE = "en-NG";

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

function timeParts(date: Date): { hour: string; minute: string; second: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LAGOS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    hour: values.hour ?? "00",
    minute: values.minute ?? "00",
    second: values.second ?? "00",
  };
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
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

  const start = new Date(`${businessDate}T00:00:00${LAGOS_OFFSET}`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export function createLagosDateTime(
  businessDate: string,
  now = new Date(),
): Date {
  getLagosBusinessDayRange(businessDate);
  const { hour, minute, second } = timeParts(now);
  return new Date(
    `${businessDate}T${hour}:${minute}:${second}${LAGOS_OFFSET}`,
  );
}

export function formatLagosDate(value: Date | string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: LAGOS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(asDate(value));
}

export function formatLagosDateTime(value: Date | string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: LAGOS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(asDate(value));
}
