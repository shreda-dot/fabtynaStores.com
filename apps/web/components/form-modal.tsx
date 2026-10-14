import type { ReactNode } from "react";
import { X } from "lucide-react";

export function FormModal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-0 sm:place-items-center sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="form-modal-title"
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-xl border border-border bg-card p-5 shadow-xl sm:max-w-2xl sm:rounded-xl sm:p-6"
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <h2 id="form-modal-title" className="text-xl font-semibold">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close form"
            onClick={onClose}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
