import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "info";

const TONES: Record<BadgeTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  accent: "border-primary/30 bg-primary/10 text-primary",
  success: "border-success/30 bg-success-surface text-success",
  warning: "border-warning/40 bg-warning-surface text-warning",
  danger: "border-danger/30 bg-danger-surface text-danger",
  info: "border-info/30 bg-info-surface text-info",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Maps a domain status/label onto a consistent badge tone. Single source of
 * truth for COMPLETED / VOIDED / DRAFT / Paid / Partial / Unpaid / Retail /
 * Wholesale etc.
 */
export function statusTone(status: string): BadgeTone {
  switch (status.trim().toUpperCase()) {
    case "COMPLETED":
    case "RECEIVED":
    case "PAID":
    case "ACTIVE":
    case "POSTED":
      return "success";
    case "VOIDED":
    case "CANCELLED":
    case "DELETED":
      return "danger";
    case "DRAFT":
    case "PARTIAL":
    case "PENDING":
      return "warning";
    case "UNPAID":
      return "info";
    case "RETAIL":
      return "info";
    case "WHOLESALE":
      return "accent";
    default:
      return "neutral";
  }
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{status}</Badge>;
}
