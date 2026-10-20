import { Prisma } from "../../generated/prisma/client.js";
import { getLagosBusinessDate } from "@fabtyna/shared";
import { validationError } from "./errors.js";

/** Helpers shared by the list endpoints (sales, purchases). */

const LAGOS_OFFSET = "+01:00"; // Africa/Lagos has no daylight saving time.

/** First instant of a Lagos business date, as a UTC ISO string. */
export function lagosDayStartIso(date: string): string {
  return new Date(`${date}T00:00:00${LAGOS_OFFSET}`).toISOString();
}

export function addOneDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/** `timestamp without time zone` columns hold UTC; compare against a UTC literal. */
export const utcTimestamp = (iso: string): Prisma.Sql =>
  Prisma.sql`(${iso}::timestamptz AT TIME ZONE 'UTC')`;

/** Keyset cursor on (timestamp, id), newest first. */
export interface Cursor {
  at: string;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<Cursor>;
    if (
      typeof parsed.at === "string" &&
      typeof parsed.id === "string" &&
      !Number.isNaN(new Date(parsed.at).getTime())
    ) {
      return { at: new Date(parsed.at).toISOString(), id: parsed.id };
    }
  } catch {
    // fall through to the error below
  }
  throw validationError("The cursor is not valid.", { field: "cursor" });
}

/** Escapes `%`, `_` and `\` so a search term is matched literally. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

export interface EffectiveDateRange {
  from: string | undefined;
  to: string | undefined;
}

export function resolveListDateRange(
  input: { from?: string; to?: string },
  now: Date,
  maxDays: number,
  options: { defaultToToday: boolean; suppressDefault: boolean },
): EffectiveDateRange {
  let from = input.from;
  let to = input.to;

  if (from === undefined && to === undefined) {
    if (!options.defaultToToday || options.suppressDefault) return { from, to };
    from = getLagosBusinessDate(now);
    to = from;
  } else if (from === undefined) {
    from = to;
  } else if (to === undefined) {
    to = from;
  }

  if (from === undefined || to === undefined) return { from, to };
  if (from > to) {
    throw validationError("'from' must not be after 'to'.", { from, to });
  }

  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  const inclusiveDays = Math.floor((end - start) / 86_400_000) + 1;
  if (inclusiveDays > maxDays) {
    throw validationError(`Date range cannot exceed ${maxDays} days. Narrow the range and try again.`, {
      maxDays,
      inclusiveDays,
    });
  }

  return { from, to };
}
