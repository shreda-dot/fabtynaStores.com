import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { MobileNav } from "./mobile-nav";
import { StorageBanner } from "./storage-banner";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex min-h-dvh overflow-hidden bg-background text-foreground lg:h-dvh"
      // Reserve room for the fixed network status bar so nothing is covered and
      // there is no layout jump when it appears.
      style={{ paddingTop: "var(--network-bar-height, 0px)" }}
    >
      <Sidebar />
      <MobileNav />
      <div className="flex min-w-0 flex-1 flex-col lg:min-h-0">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <StorageBanner />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
