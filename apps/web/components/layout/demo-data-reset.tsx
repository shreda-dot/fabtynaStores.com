"use client";

import { useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resetDemoData } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { confirm } from "@/stores/confirm-store";
import { toast } from "@/stores/toast-store";

export function DemoDataReset() {
  const queryClient = useQueryClient();

  async function reset() {
    const ok = await confirm({
      title: "Reset demo data?",
      description:
        "All demo products, customers, suppliers, purchases and sales will be replaced with the original sample data. This cannot be undone.",
      confirmLabel: "Reset demo data",
      tone: "danger",
    });
    if (!ok) return;

    try {
      resetDemoData();
      queryClient.clear();
      toast.success("Demo data reset", "The original sample data has been restored.");
    } catch (err) {
      toast.error(toUserMessage(err));
    }
  }

  if (process.env.NEXT_PUBLIC_API_MODE === "real") return null;

  return (
    <Button variant="secondary" onClick={() => void reset()}>
      <RotateCcw aria-hidden="true" className="h-4 w-4" />
      <span className="hidden sm:inline">Reset demo data</span>
      <span className="sm:hidden">Reset</span>
    </Button>
  );
}
