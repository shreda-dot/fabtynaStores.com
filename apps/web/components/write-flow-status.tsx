"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { productsApi } from "@/lib/api";
import { apiFieldErrors } from "@/lib/api/client";
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
 * UNKNOWN outcome with Retry safely (same key), Check now, and a link to the list.
 *
 * A write the client gave up waiting for is never cancelled, so if it settles
 * later the flow reconciles itself and this panel shows the true result.
 */
export function WriteFlowStatus({
  flow,
  onRetry,
  checkHref,
  checkLabel,
  onCheckNow,
  showFieldErrors = false,
  onReverseAction,
  reverseActionLabel = "Go to payments",
}: {
  flow: UseWriteFlow;
  /** Re-submits with the SAME key. Only offered after an unknown outcome. */
  onRetry: () => void;
  checkHref: string;
  checkLabel: string;
  /**
   * Extra work for "Check now" (e.g. asserting the document now exists). The
   * default refreshes the active queries so every visible list shows the truth.
   */
  onCheckNow?: () => void | Promise<void>;
  showFieldErrors?: boolean;
  onReverseAction?: () => void;
  reverseActionLabel?: string;
}) {
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);

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

  async function checkNow(): Promise<void> {
    if (checking) return;
    setChecking(true);
    try {
      if (onCheckNow) await onCheckNow();
      else await queryClient.refetchQueries({ type: "active" });
    } finally {
      setChecking(false);
      // The user has seen the truth (the list), so stop showing the warning.
      // The key is kept: an accidental re-submit still replays.
      flow.dismiss();
    }
  }

  if (flow.status === "pending") {
    return (
      <p
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 rounded-md border border-border bg-muted p-3 text-sm text-foreground"
      >
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        {flow.phase === "still-working"
          ? "Still working, please keep this page open."
          : "Saving..."}
      </p>
    );
  }

  if (flow.status === "failed") {
    const friendly = friendlyWriteError(flow.error);
    const fieldErrors = showFieldErrors ? apiFieldErrors(flow.error) : {};
    const text =
      quotedId !== null && product.data?.name
        ? replaceIdWithName(friendly.message, quotedId, product.data.name)
        : friendly.message;
    return (
      <div role="alert" className="space-y-2 rounded-md border border-danger/30 bg-card p-3 text-sm">
        <p className="text-danger">{text}</p>
        {Object.keys(fieldErrors).length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {Object.entries(fieldErrors).map(([field, message]) => (
              <li key={field}>
                <span className="font-medium text-foreground">{field}:</span> {message}
              </li>
            ))}
          </ul>
        )}
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
          Do not enter it again. Check now refreshes the list so you can see whether it is there.
          Retry safely sends the same request, so it cannot be recorded twice.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void checkNow()} loading={checking}>
            Check now
          </Button>
          <Button size="sm" variant="secondary" onClick={onRetry} disabled={checking}>
            Retry safely
          </Button>
          <Link href={checkHref} className={buttonClasses({ variant: "secondary", size: "sm" })}>
            {checkLabel}
          </Link>
        </div>
      </div>
    );
  }

  if (flow.status === "success" && flow.reconciled) {
    return (
      <p
        role="status"
        className="rounded-md border border-border bg-muted p-3 text-sm text-foreground"
      >
        Saved. The request finished after the page stopped waiting, and the lists have been
        refreshed.
      </p>
    );
  }

  return null;
}
