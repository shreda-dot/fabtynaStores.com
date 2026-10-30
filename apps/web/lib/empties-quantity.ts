export type EmptiesQuantityResult =
  | { ok: true; quantity: number }
  | { ok: false; message: string };

/**
 * Parses a typed empties count. Empties are whole objects (bottles and crates),
 * so unlike sale quantities this rejects decimals and negative numbers.
 *
 * `allowNegative` is for a count adjustment, where the typed value is signed
 * and carries the direction of the correction; zero is still rejected because a
 * movement must change the balance.
 */
export function parseEmptiesQuantityText(
  text: string,
  options: { allowNegative?: boolean } = {},
): EmptiesQuantityResult {
  const trimmed = text.trim();
  if (trimmed === "") {
    return { ok: false, message: "Enter a whole number." };
  }
  const pattern = options.allowNegative ? /^-?\d+$/ : /^\d+$/;
  if (!pattern.test(trimmed)) {
    return { ok: false, message: "Enter a whole number, for example 24. Fractions are not allowed." };
  }
  const quantity = Number(trimmed);
  if (!Number.isSafeInteger(quantity)) {
    return { ok: false, message: "That number is too large." };
  }
  if (quantity === 0) {
    return { ok: false, message: "Quantity must not be zero." };
  }
  if (!options.allowNegative && quantity < 0) {
    return { ok: false, message: "Quantity must be greater than zero." };
  }
  return { ok: true, quantity };
}
