import { AlertTriangle } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/cn";

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  detail,
  className,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  /** Technical detail; only shown collapsed (e.g. failed request body). */
  detail?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-md border border-danger/30 bg-card p-5 text-left",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          aria-hidden="true"
          className="mt-0.5 h-5 w-5 shrink-0 text-danger"
        />
        <div className="min-w-0 flex-1">
          <p className="text-section font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
          {onRetry && (
            <div className="mt-3">
              <Button variant="secondary" size="sm" onClick={onRetry}>
                Try again
              </Button>
            </div>
          )}
          {detail && detail.trim() !== "" && (
            <details className="mt-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">Technical details</summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded-sm bg-muted p-2 whitespace-pre-wrap break-words">
                {detail}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
