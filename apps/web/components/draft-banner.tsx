"use client";

import { Button } from "@/components/ui/button";
import type { FormDraft } from "@/hooks/use-form-draft";
import { formatDraftTime } from "@/lib/form-draft";

/** Offers to restore a saved draft. Renders nothing when there is none. */
export function DraftBanner<T>({ draft }: { draft: FormDraft<T> }) {
  if (draft.pending === null) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning-surface px-4 py-3 text-sm text-warning"
    >
      <span>
        You have an unsaved draft from {formatDraftTime(draft.pending.savedAt)}. Restore it?
      </span>
      <span className="flex gap-2">
        <Button size="sm" onClick={draft.restore}>
          Restore
        </Button>
        <Button size="sm" variant="secondary" onClick={draft.discard}>
          Discard
        </Button>
      </span>
    </div>
  );
}
