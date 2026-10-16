"use client";

export function DateFilter({
  id,
  label = "Date",
  value,
  onChange,
  max,
}: {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  max?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="date"
          value={value}
          max={max}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base"
        />
        {value !== "" && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="min-h-12 shrink-0 rounded-md border border-border px-3 text-sm hover:bg-muted"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
