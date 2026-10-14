"use client";

import { useState } from "react";
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

export function MoneyInput({
  id,
  label,
  defaultValueKobo,
  onKoboChange,
}: MoneyInputProps) {
  const [text, setText] = useState(() => toMoneyText(defaultValueKobo));
  const [error, setError] = useState("");

  function change(value: string) {
    setText(value);
    try {
      const amountKobo = parseMoneyInputToKobo(value);
      setError("");
      onKoboChange(amountKobo);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enter a valid amount.");
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
          aria-invalid={error !== ""}
          aria-describedby={error ? `${id}-error` : undefined}
          className="min-w-0 flex-1 bg-transparent px-2 py-3 text-base outline-none"
        />
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
