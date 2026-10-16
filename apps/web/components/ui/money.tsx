import { formatNaira } from "@fabtyna/shared";
import { cn } from "@/lib/cn";

export type MoneyValue = string | bigint;

function toBigInt(value: MoneyValue): bigint {
  if (typeof value === "bigint") return value;
  if (value.trim() === "") return 0n;
  return BigInt(value);
}

/**
 * Renders a kobo amount. Always tabular so digits line up. Negative amounts
 * get a minus sign AND red text (never colour alone, because formatNaira
 * already emits the sign).
 */
export function Money({
  kobo,
  className,
  tone = "auto",
}: {
  kobo: MoneyValue;
  className?: string;
  /** `auto` reddens negatives; `neutral` keeps the inherited colour. */
  tone?: "auto" | "neutral";
}) {
  const value = toBigInt(kobo);
  const negative = value < 0n;
  return (
    <span
      className={cn(
        "tabular whitespace-nowrap",
        negative && tone === "auto" && "text-danger",
        className,
      )}
    >
      {formatNaira(value)}
    </span>
  );
}
