import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { MobileNav } from "./mobile-nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh overflow-hidden bg-background text-foreground lg:h-dvh">
      <Sidebar />
      <MobileNav />
      <div className="flex min-h-dvh min-w-0 flex-1 flex-col lg:h-dvh lg:min-h-0">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
