import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/layout/theme-toggle";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="fixed right-3 top-3 z-40">
        <ThemeToggle />
      </div>
      {children}
    </>
  );
}
