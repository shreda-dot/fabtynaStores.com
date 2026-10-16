"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 px-4 py-12">
      <ErrorState
        title="This page couldn't load"
        message="Something went wrong while loading this page. You can try again, or head back to the dashboard."
        onRetry={reset}
        detail={
          process.env.NODE_ENV === "development"
            ? (error.stack ?? error.message)
            : undefined
        }
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={reset}>
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          Try again
        </Button>
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center rounded-md border border-border bg-card px-4 text-sm font-medium hover:bg-muted"
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
