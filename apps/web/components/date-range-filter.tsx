"use client";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

type Preset = "today" | "yesterday" | "week" | "month" | "last30";

const PRESETS: { key: Preset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "last30", label: "Last 30 days" },
];

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The last `days` Lagos days, counting today. */
export function lastDaysRange(today: string, days: number): { from: string; to: string } {
  return { from: addDays(today, -(days - 1)), to: today };
}

/** What a list page shows before the user picks anything: the last 30 days. */
export function defaultListRange(today: string): { from: string; to: string } {
  return lastDaysRange(today, 30);
}

function presetRange(preset: Preset, today: string): { from: string; to: string } {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const day = addDays(today, -1);
      return { from: day, to: day };
    }
    case "week": {
      const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
      return { from: addDays(today, -((weekday + 6) % 7)), to: today }; // Monday to today
    }
    case "month":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "last30":
      return lastDaysRange(today, 30);
  }
}

export function DateRangeFilter({
  idPrefix,
  from,
  to,
  today,
  onChange,
  problem,
}: {
  idPrefix: string;
  from: string;
  to: string;
  /** The current Lagos business date; later dates cannot be chosen. */
  today: string;
  onChange: (range: { from: string; to: string }) => void;
  /** A plain-language problem with the range, or null. */
  problem: string | null;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <Button
            key={preset.key}
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onChange(presetRange(preset.key, today))}
          >
            {preset.label}
          </Button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id={`${idPrefix}-from`} label="From">
          <Input
            id={`${idPrefix}-from`}
            type="date"
            value={from}
            max={today}
            onChange={(event) => onChange({ from: event.target.value, to })}
          />
        </FormField>
        <FormField id={`${idPrefix}-to`} label="To">
          <Input
            id={`${idPrefix}-to`}
            type="date"
            value={to}
            max={today}
            min={from || undefined}
            onChange={(event) => onChange({ from, to: event.target.value })}
          />
        </FormField>
      </div>
      {problem !== null && (
        <p role="alert" className="text-sm font-medium text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}