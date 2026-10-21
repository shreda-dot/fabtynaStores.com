"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authApi } from "@/lib/api";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let mounted = true;
    void authApi.me().then(
      () => {
        if (mounted) setAllowed(true);
      },
      () => {
        if (!mounted) return;
        const next = `${window.location.pathname}${window.location.search}`;
        router.replace(`/login?next=${encodeURIComponent(next)}`);
      },
    );
    return () => {
      mounted = false;
    };
  }, [router]);

  if (!allowed) {
    return (
      <div className="grid min-h-dvh place-items-center px-4">
        <p className="text-sm text-muted-foreground">Checking your session…</p>
      </div>
    );
  }
  return children;
}
