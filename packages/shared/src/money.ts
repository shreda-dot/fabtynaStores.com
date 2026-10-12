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

  return `${formattedNaira}${decimalSeparator}${fraction}`;
}
