"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";

type InfoHintProps = {
  label: string;
  children: ReactNode;
  align?: "left" | "right" | "auto";
  placement?: "top" | "bottom";
};

export function InfoHint({ label, children, align = "auto", placement = "bottom" }: InfoHintProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLSpanElement | null>(null);

  const positionPanel = useCallback(() => {
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!root || !panel) return;

    let left = 0;
    let right = document.documentElement.clientWidth;
    for (let ancestor = root.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (/(auto|scroll|hidden|clip)/.test(window.getComputedStyle(ancestor).overflowX)) {
        const bounds = ancestor.getBoundingClientRect();
        left = Math.max(left, bounds.left + ancestor.clientLeft);
        right = Math.min(right, bounds.left + ancestor.clientLeft + ancestor.clientWidth);
      }
    }

    const margin = 12;
    panel.style.maxWidth = `${Math.max(0, right - left - 2 * margin)}px`;
    const rootBounds = root.getBoundingClientRect();
    const width = panel.getBoundingClientRect().width;
    const preferRight = align === "right" ||
      (align === "auto" && right - rootBounds.left < width + margin &&
        rootBounds.right - left > right - rootBounds.left);
    const preferred = preferRight ? rootBounds.right - width : rootBounds.left;
    const bounded = Math.max(left + margin, Math.min(preferred, right - margin - width));
    panel.style.left = `${bounded - rootBounds.left}px`;
  }, [align]);

  useEffect(() => {
    positionPanel();
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    return () => {
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", positionPanel, true);
    };
  }, [positionPanel]);

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

  const verticalPosition =
    placement === "top"
      ? "bottom-full mb-2"
      : "top-full mt-2";

  return (
    <span
      ref={rootRef}
      className="group relative inline-flex align-middle"
      onMouseEnter={positionPanel}
      onFocus={positionPanel}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => {
          positionPanel();
          setOpen((value) => !value);
        }}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Info aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <span
        ref={panelRef}
        role="tooltip"
        className={`absolute left-0 z-50 block w-72 max-w-[calc(100vw-3rem)] rounded-lg border border-border/80 bg-background px-3 py-2.5 text-left text-xs leading-5 text-foreground shadow-2xl ring-1 ring-black/5 transition-opacity duration-150 dark:ring-white/5 ${verticalPosition} ${
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