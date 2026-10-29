"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { AuthApiError, authApi } from "@/lib/api";
import { reevaluateConnectivity } from "@/stores/network-store";
import { setDraftUser } from "@/lib/form-draft";

export const AUTH_ME_KEY = ["auth", "me"] as const;

const SESSION_CHECK_STALE_MS = 2 * 60 * 1000;
const SLOW_NOTICE_MS = 12_000;

/** The server could not be reached or answered badly: the session itself may still be fine. */
function isTransient(error: unknown): boolean {
  return (
    error instanceof AuthApiError &&
    (error.kind === "network" ||
      error.kind === "timeout" ||
      error.kind === "server" ||
      error.kind === "rate-limited")
  );
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [slow, setSlow] = useState(false);
  const [wasPending, setWasPending] = useState(true);

  const me = useQuery({
    queryKey: AUTH_ME_KEY,
    queryFn: () => authApi.me(),
    staleTime: SESSION_CHECK_STALE_MS,
    retry: false,
  });

  const sessionInvalid = me.isError && !isTransient(me.error);

  // Reset the "slow" notice when the check settles, by adjusting state during
  // render rather than in an effect (which would trigger a cascading render).
  if (wasPending !== me.isPending) {
    setWasPending(me.isPending);
    setSlow(false);
  }

  useEffect(() => {
    if (me.data) setDraftUser(me.data.id);
  }, [me.data]);

  useEffect(() => {
    if (!sessionInvalid) return;
    const next = `${window.location.pathname}${window.location.search}`;
    router.replace(`/login?next=${encodeURIComponent(next)}`);
  }, [sessionInvalid, router]);

  useEffect(() => {
    if (!me.isPending) return;
    const timer = window.setTimeout(() => setSlow(true), SLOW_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [me.isPending]);

  // Signed in (or at least not proven otherwise): show the app. A background
  // re-check that fails for a network reason keeps the app on screen.
  if (me.data && !sessionInvalid) return children;

  if (me.isError && !sessionInvalid) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background px-4">
        <div role="alert" className="flex max-w-sm flex-col items-center gap-3 text-center">
          <p className="text-base font-semibold text-foreground">Can&apos;t reach the server</p>
          <p className="text-sm text-muted-foreground">
            Your session is not affected. Check your connection and try again.
          </p>
          <button
            type="button"
            onClick={() => {
              reevaluateConnectivity();
              void me.refetch();
            }}
            disabled={me.isFetching}
            className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
          >
            {me.isFetching ? "Trying…" : "Try again"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4">
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 text-center">
        <div
          aria-hidden="true"
          className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
        />
        <p className="text-sm text-muted-foreground">
          {sessionInvalid ? "Taking you to sign in…" : "Verifying access…"}
        </p>
        {slow && !sessionInvalid && (
          <p className="max-w-xs text-xs text-muted-foreground">
            This is taking longer than usual. The server may be waking up, so please wait a moment.
          </p>
        )}
      </div>
    </div>
  );
}