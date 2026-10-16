import type { ComponentType, ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/cn";

export type StatTone = "default" | "success" | "danger" | "warning";

const TONE_VALUE: Record<StatTone, string> = {
  default: "text-foreground",
  success: "text-success",
  danger: "text-danger",
  warning: "text-warning",
};

export type StatTrend = {
  direction: "up" | "down" | "flat";
  label: string;
  /** Whether "up" is good (green) or bad (red). Defaults to true. */
  upIsGood?: boolean;
};

const TREND_ICON = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  flat: Minus,
} as const;

/**
 * Summary card. Large value, optional label/trend. Trend direction is conveyed
 * by an icon and text, never by colour alone.
 */
export function StatCard({
  label,
  value,
  hint,
  tone = "default",
  trend,
  icon: Icon,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: StatTone;
  trend?: StatTrend;
  icon?: ComponentType<{ className?: string }>;
  className?: string;
}) {
  const TrendIcon = trend ? TREND_ICON[trend.direction] : null;
  const trendGood = trend
    ? trend.direction === "flat"
      ? true
      : (trend.upIsGood ?? true) === (trend.direction === "up")
    : true;

  return (
    <div className={cn("rounded-md border border-border bg-card p-4", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon && (
          <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </div>
      <p className={cn("mt-2 text-xl font-semibold tabular", TONE_VALUE[tone])}>
        {value}
      </p>
      {(trend || hint) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {trend && TrendIcon && (
            <span
              className={cn(
                "inline-flex items-center gap-1 font-medium",
                trendGood ? "text-success" : "text-danger",
              )}
            >
              <TrendIcon aria-hidden="true" className="h-3.5 w-3.5" />
              {trend.label}
            </span>
          )}
          {hint && <span className="text-muted-foreground">{hint}</span>}
        </div>
      )}
    </div>
  );
}
