"use client";

import { getLagosBusinessDate, getLagosBusinessDayRange } from "@fabtyna/shared";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * From/To Lagos date inputs with quick presets. `error` comes from
 * validateReportRange (order and the 366-day inclusive cap), so nothing
 * invalid is ever sent to the API.
 */
export function ReportRangeFields({
  idPrefix,
  from,
  to,
  businessDate,
  error,
  onChange,
}: {
  idPrefix: string;
  from: string;
  to: string;
  businessDate: string;
  error: string | null;
  onChange: (from: string, to: string) => void;
}) {
  const { start } = getLagosBusinessDayRange(businessDate);
  const yesterday = getLagosBusinessDate(new Date(start.getTime() - DAY_MS));
  const sevenDaysAgo = getLagosBusinessDate(
    new Date(start.getTime() - 6 * DAY_MS),
  );
  const monthStart = `${businessDate.slice(0, 7)}-01`;

  const presets = [
    { label: "Today", from: businessDate, to: businessDate },
    { label: "Yesterday", from: yesterday, to: yesterday },
    { label: "Last 7 days", from: sevenDaysAgo, to: businessDate },
    { label: "This month", from: monthStart, to: businessDate },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <Button
            key={preset.label}
            size="sm"
            variant={
              from === preset.from && to === preset.to ? "primary" : "secondary"
            }
            onClick={() => onChange(preset.from, preset.to)}
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
            max={businessDate}
            aria-invalid={error !== null}
            onChange={(event) => onChange(event.target.value, to)}
          />
        </FormField>
        <FormField id={`${idPrefix}-to`} label="To">
          <Input
            id={`${idPrefix}-to`}
            type="date"
            value={to}
            max={businessDate}
            aria-invalid={error !== null}
            onChange={(event) => onChange(from, event.target.value)}
          />
        </FormField>
      </div>
      {error !== null && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Shows the range the server actually used (from the response). */
export function EffectiveRange({
  from,
  to,
  channel,
}: {
  from: string;
  to: string;
  channel?: string | null;
}) {
  return (
    <p className="text-xs text-muted-foreground">
      Showing {from === to ? from : `${from} to ${to}`} (Lagos dates, as used by
      the server)
      {channel ? ` · ${channel === "RETAIL" ? "Retail" : "Wholesale"} only` : ""}
    </p>
  );
}
