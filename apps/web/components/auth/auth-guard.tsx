"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authApi } from "@/lib/api";
import { setDraftUser } from "@/lib/form-draft";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let mounted = true;
    void authApi.me().then(
      (user) => {
        setDraftUser(user.id);
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
      <div className="grid min-h-dvh place-items-center bg-background px-4">
        <div className="flex flex-col items-center gap-3">
          {/* Animated Spinner */}
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground animate-pulse">
            Verifying access…
          </p>
        </div>
      </div>
    );
  }

  return children;
}