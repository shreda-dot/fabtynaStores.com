import { formatNaira } from "@fabtyna/shared";
import { ApiError } from "./client";

export type FriendlyWriteError = {
  message: string;
  /**
   * reload: the form is stale (idempotency mismatch)
   * reverse-payments: a void is blocked by a live payment
   */
  action?: "reload" | "reverse-payments";
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function kobo(value: unknown): string | null {
  return typeof value === "string" && /^-?\d+$/.test(value)
    ? formatNaira(value)
    : null;
}

const LOCATION_NAMES: Record<string, string> = {
  WAREHOUSE: "the warehouse",
  RETAIL_SHELF: "the retail shelf",
  MARKET: "the market",
};

/**
 * Turns a business answer (4xx) from the sales/purchases API into text for the
 * owner. 5xx is never shown raw: the client already replaced it with generic
 * text, and the write flow treats it as UNKNOWN rather than failed.
 */
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** First product-style id quoted in a server message, if any. */
export function findQuotedId(message: string): string | null {
  return /'([0-9a-f-]{36})'/i.exec(message)?.[1] ?? UUID_PATTERN.exec(message)?.[0] ?? null;
}

/** Replaces a raw id in a server message with a readable name. */
export function replaceIdWithName(message: string, id: string, name: string): string {
  return message.split(`'${id}'`).join(`'${name}'`).split(id).join(`'${name}'`);
}

export function friendlyWriteError(cause: unknown): FriendlyWriteError {
  if (!(cause instanceof ApiError)) {
    return {
      message:
        cause instanceof Error && cause.message.trim() !== ""
          ? cause.message.trim()
          : "Something went wrong. Please try again.",
    };
  }
  const details = record(cause.details);

  if (cause.code === "IDEMPOTENCY_MISMATCH") {
    return {
      message:
        "This form changed after an earlier attempt was sent. Reload the form and enter it again.",
      action: "reload",
    };
  }

  if (cause.code === "INSUFFICIENT_STOCK") {
    const name = typeof details.productName === "string" ? details.productName : null;
    const available = details.availableUnits;
    if (name !== null && typeof available === "number") {
      const where =
        typeof details.location === "string"
          ? (LOCATION_NAMES[details.location] ?? details.location)
          : "this location";
      return {
        message: `Not enough '${name}' in ${where}: ${available} on hand${
          typeof details.requestedUnits === "number"
            ? `, ${details.requestedUnits} needed`
            : ""
        }.`,
      };
    }
    return { message: cause.userMessage };
  }

  if (typeof details.accountName === "string" && details.balanceKobo !== undefined) {
    const balance = kobo(details.balanceKobo);
    const amount = kobo(details.amountKobo);
    if (balance !== null && amount !== null) {
      return {
        message: `${details.accountName} holds ${balance}, but ${amount} is needed. Record income or reconcile the account first, then try again.`,
      };
    }
  }

  if (details.amountDueKobo !== undefined) {
    const due = kobo(details.amountDueKobo);
    if (due !== null) {
      return {
        message: `That is more than is still owed. The amount due is ${due}.`,
      };
    }
  }

  if (typeof details.onHandUnits === "number" && typeof details.productName === "string") {
    return {
      message: `Cannot void: '${details.productName}' has ${details.onHandUnits} on hand but ${String(
        details.neededUnits,
      )} came in with this purchase. This stock has already been sold or moved.`,
    };
  }

  if (/Reverse the payments? first/i.test(cause.userMessage)) {
    return { message: cause.userMessage, action: "reverse-payments" };
  }

  return { message: cause.userMessage };
}
