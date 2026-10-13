export type KoboAmount = bigint | string;

export function formatNaira(amountKobo: KoboAmount, locale = "en-NG"): string {
  const kobo = typeof amountKobo === "bigint" ? amountKobo : BigInt(amountKobo);
  const negative = kobo < 0n;
  const absoluteKobo = negative ? -kobo : kobo;
  const naira = absoluteKobo / 100n;
  const fraction = (absoluteKobo % 100n).toString().padStart(2, "0");
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const parts = formatter.formatToParts(negative ? -naira : naira);
  const decimalSeparator =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")
      ?.value ?? ".";
  const formattedNaira = parts.map((part) => part.value).join("");

  const signedNaira = negative && naira === 0n ? `-${formattedNaira}` : formattedNaira;
  return `${signedNaira}${decimalSeparator}${fraction}`;
}

const MONEY_INPUT_PATTERN =
  /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$|^\.\d{1,2}$/;

export function parseMoneyInputToKobo(input: string): string {
  const trimmed = input.trim();

  if (trimmed === "") {
    throw new RangeError("Amount must not be empty.");
  }
  if (trimmed.includes("-")) {
    throw new RangeError("Amount must not be negative.");
  }
  if (!MONEY_INPUT_PATTERN.test(trimmed)) {
    throw new RangeError(
      "Amount must be a valid number with at most 2 decimal places.",
    );
  }

  const withoutCommas = trimmed.replace(/,/g, "");
  const [nairaPart, fractionPart = ""] = withoutCommas.split(".");
  const naira = nairaPart === "" ? 0n : BigInt(nairaPart);
  const fraction = BigInt(fractionPart.padEnd(2, "0").slice(0, 2));
  const kobo = naira * 100n + fraction;

  return kobo.toString();
}
