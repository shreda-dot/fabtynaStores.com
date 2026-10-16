"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";

type InfoHintProps = {
  label: string;
  children: ReactNode;
  align?: "left" | "right" | "auto";
};

export function InfoHint({ label, children, align = "auto" }: InfoHintProps) {
  const [open, setOpen] = useState(false);
  const [computedAlign, setComputedAlign] = useState<"left" | "right">("left");
  const rootRef = useRef<HTMLSpanElement | null>(null);

  // Dynamically calculate whether to open left or right based on screen position
  useEffect(() => {
    if (!rootRef.current) return;

    function checkPosition() {
      if (!rootRef.current) return;
      const rect = rootRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;

      if (align === "auto") {
        // If the icon is in the right half of the screen, align right (expand leftwards)
        // If it's in the left half, align left (expand rightwards)
        if (rect.left > viewportWidth / 2) {
          setComputedAlign("right");
        } else {
          setComputedAlign("left");
        }
      } else {
        setComputedAlign(align);
      }
    }

    checkPosition();
    window.addEventListener("resize", checkPosition);
    return () => window.removeEventListener("resize", checkPosition);
  }, [align, open]);

  useEffect(() => {
    function handlePointer(event: MouseEvent | TouchEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("touchstart", handlePointer);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("touchstart", handlePointer);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const panelPosition =
    computedAlign === "right"
      ? "right-0 origin-top-right"
      : "left-0 origin-top-left";

  return (
    <span ref={rootRef} className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Info aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <span
        role="tooltip"
        className={`absolute top-full z-50 mt-2 block w-72 max-w-[calc(100vw-3rem)] rounded-lg border border-border/80 bg-background px-3 py-2.5 text-left text-xs leading-5 text-foreground shadow-2xl ring-1 ring-black/5 transition-opacity duration-150 dark:ring-white/5 ${panelPosition} ${
          open
            ? "pointer-events-auto visible opacity-100"
            : "pointer-events-none invisible opacity-0 sm:group-hover:visible sm:group-hover:opacity-100 sm:group-focus-within:visible sm:group-focus-within:opacity-100"
        }`}
      >
        {children}
      </span>
    </span>
  );
}