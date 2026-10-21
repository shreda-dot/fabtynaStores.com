"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { productsApi } from "@/lib/api";
import {
  findQuotedId,
  friendlyWriteError,
  replaceIdWithName,
} from "@/lib/api/friendly-errors";
import { queryKeys } from "@/lib/query-keys";
import type { UseWriteFlow } from "@/hooks/use-write-flow";

/**
 * Shows the state of a write: saving text while pending, the friendly message
 * after a business failure, and the "may or may not have saved" panel after an
 * UNKNOWN outcome with Retry safely (same key) and a link to check the list.
 */
export function WriteFlowStatus({
  flow,
  onRetry,
  checkHref,
  checkLabel,
  onReverseAction,
  reverseActionLabel = "Go to payments",
}: {
  flow: UseWriteFlow;
  /** Re-submits with the SAME key. Only offered after an unknown outcome. */
  onRetry: () => void;
  checkHref: string;
  checkLabel: string;
  onReverseAction?: () => void;
  reverseActionLabel?: string;
}) {
  const failedMessage =
    flow.status === "failed" ? friendlyWriteError(flow.error).message : "";
  const quotedId = findQuotedId(failedMessage);
  const product = useQuery({
    queryKey: queryKeys.products.detail(quotedId ?? ""),
    queryFn: () => productsApi.getById(quotedId ?? ""),
    enabled: quotedId !== null,
    staleTime: 60_000,
    retry: false,
  });

  if (flow.status === "pending") {
    if (flow.phase === "none") return null;
    return (
      <p
        role="status"
        className="flex items-center gap-2 rounded-md border border-border bg-muted p-3 text-sm text-foreground"
      >
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        {flow.phase === "saving"
          ? "Saving..."
          : "Still working, please keep this page open."}
      </p>
    );
  }

  if (flow.status === "failed") {
    const friendly = friendlyWriteError(flow.error);
    const text =
      quotedId !== null && product.data?.name
        ? replaceIdWithName(friendly.message, quotedId, product.data.name)
        : friendly.message;
    return (
      <div role="alert" className="space-y-2 rounded-md border border-danger/30 bg-card p-3 text-sm">
        <p className="text-danger">{text}</p>
        {friendly.action === "reload" && (
          <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
            Reload the form
          </Button>
        )}
        {friendly.action === "reverse-payments" && onReverseAction && (
          <Button size="sm" variant="secondary" onClick={onReverseAction}>
            {reverseActionLabel}
          </Button>
        )}
      </div>
    );
  }

  if (flow.status === "unknown") {
    return (
      <div role="alert" className="space-y-2 rounded-md border border-warning/40 bg-card p-3 text-sm">
        <p className="font-medium text-foreground">We could not confirm whether this was saved.</p>
        <p className="text-muted-foreground">
          Do not enter it again. Retry safely sends the same request, so it cannot be recorded
          twice. Or check the list first.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onRetry}>
            Retry safely
          </Button>
          <Link href={checkHref} className={buttonClasses({ variant: "secondary", size: "sm" })}>
            {checkLabel}
          </Link>
        </div>
      </div>
    );
  }

  return null;
}
