"use client";

import { useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { resetDemoData } from "@/lib/api";

export function DemoDataReset() {
  const queryClient = useQueryClient();

  function reset() {
    const confirmed = window.confirm(
      "Reset all demo products and suppliers to the original sample data?",
    );
    if (!confirmed) return;
    resetDemoData();
    queryClient.clear();
  }

  if (process.env.NEXT_PUBLIC_API_MODE === "real") return null;

  return (
    <button
      type="button"
      onClick={reset}
      className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <RotateCcw aria-hidden="true" className="h-4 w-4" />
      <span className="hidden sm:inline">Reset demo data</span>
      <span className="sm:hidden">Reset</span>
    </button>
  );
}
