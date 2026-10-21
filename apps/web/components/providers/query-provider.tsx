"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  setMockStoreInvalidator,
  setupMockStoreStorageListener,
} from "@/lib/api/mock-store";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 15_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  useEffect(() => {
    setMockStoreInvalidator(() => {
      void queryClient.invalidateQueries();
    });
    const cleanup = setupMockStoreStorageListener();
    const handleUnauthorized = () => {
      queryClient.clear();
      if (window.location.pathname !== "/login") {
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.replace(`/login?next=${encodeURIComponent(next)}`);
      }
    };
    window.addEventListener("fabtyna:unauthorized", handleUnauthorized);
    return () => {
      cleanup();
      window.removeEventListener("fabtyna:unauthorized", handleUnauthorized);
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
