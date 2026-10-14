"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { isDemoLoggedIn } from "@/lib/auth/demo-auth";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const allowed = useSyncExternalStore(
    () => () => {},
    isDemoLoggedIn,
    () => false,
  );

  useEffect(() => {
    if (!allowed) router.replace("/login");
  }, [allowed, router]);

  if (!allowed) {
    return (
      <div className="grid min-h-dvh place-items-center px-4">
        <p className="text-sm text-muted-foreground">Checking demo session…</p>
      </div>
    );
  }
  return children;
}
