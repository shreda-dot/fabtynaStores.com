"use client";

import { useRef, useState } from "react";
import { parseMoneyInputToKobo } from "@fabtyna/shared";

type MoneyInputProps = {
  id: string;
  label: string;
  defaultValueKobo: string;
  onKoboChange: (value: string) => void;
};

function toMoneyText(koboText: string): string {
  if (!/^(?:0|[1-9]\d*)$/.test(koboText)) return "";
  const kobo = BigInt(koboText);
  return `${kobo / 100n}.${(kobo % 100n).toString().padStart(2, "0")}`;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Formats raw input into a grouped money string while the user types, e.g.
 * "1000000" -> "1,000,000" and "1234.5" -> "1,234.5". Only digits and a single
 * decimal point (max 2 places) are kept.
 */
function formatMoneyText(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "");
  const dotIndex = cleaned.indexOf(".");
  const intDigits = dotIndex === -1 ? cleaned : cleaned.slice(0, dotIndex);
  const groupedInt = groupThousands(intDigits.replace(/^0+(?=\d)/, ""));
  if (dotIndex === -1) return groupedInt;
  const fraction = cleaned.slice(dotIndex + 1).replace(/\D/g, "").slice(0, 2);
  return `${groupedInt}.${fraction}`;
}

const ZERO_TEXT = "0.00";

export function MoneyInput({
  id,
  label,
  defaultValueKobo,
  onKoboChange,
}: MoneyInputProps) {
  const [text, setText] = useState(() => toMoneyText(defaultValueKobo));
  const [error, setError] = useState("");
  const textAtFocus = useRef("");

  function change(value: string) {
    const formatted = formatMoneyText(value);
    setText(formatted);
    if (formatted.trim() === "") {
      setError("");
      onKoboChange("");
      return;
    }
    try {
      const amountKobo = parseMoneyInputToKobo(formatted);
      setError("");
      onKoboChange(amountKobo);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enter a valid amount.");
      onKoboChange("");
    }
  }

  function handleFocus() {
    textAtFocus.current = text;
    // Clear a default "0.00" so the user can type straight away.
    if (text === ZERO_TEXT || text === "0") {
      setText("");
      setError("");
    }
  }

  function handleBlur() {
    if (text.trim() !== "") return;
    // Restore the value the field had before focus so we never emit "".
    const restored = textAtFocus.current;
    setText(restored);
    try {
      setError("");
      onKoboChange(parseMoneyInputToKobo(restored));
    } catch {
      onKoboChange("");
    }
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <div className="flex min-h-12 items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
        <span className="pl-3 text-sm text-muted-foreground" aria-hidden="true">
          ₦
        </span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(event) => change(event.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          aria-invalid={error !== ""}
          aria-describedby={error ? `${id}-error` : undefined}
          className="min-w-0 flex-1 bg-transparent px-2 py-3 text-base outline-none"
        />
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}