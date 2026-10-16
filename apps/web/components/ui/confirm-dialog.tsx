"use client";

import { useState } from "react";
import { Modal } from "./modal";
import { Button } from "./button";
import { toast } from "@/stores/toast-store";
import { useConfirmStore, type ConfirmOptions } from "@/stores/confirm-store";
import { toTechnicalDetail, toUserMessage } from "@/lib/api/client";

/**
 * Renders the active confirmation. Mounted once in the root layout.
 *
 * The dialog is keyed by the store's open-token so every confirmation starts
 * with a clean loading/error state (no reset-on-effect needed).
 */
export function ConfirmDialogHost() {
  const current = useConfirmStore((state) => state.current);
  const token = useConfirmStore((state) => state.token);
  const settle = useConfirmStore((state) => state.settle);

  if (!current) return null;

  return <ConfirmDialog key={token} current={current} settle={settle} />;
}

function ConfirmDialog({
  current,
  settle,
}: {
  current: ConfirmOptions;
  settle: (result: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleConfirm() {
    if (!current.onConfirm) {
      settle(true);
      return;
    }
    setLoading(true);
    setError("");
    try {
      await current.onConfirm();
      if (current.successMessage) toast.success(current.successMessage);
      settle(true);
    } catch (cause) {
      setError(toUserMessage(cause));
      setLoading(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => settle(false)}
      title={current.title}
      description={current.description}
      size="sm"
      busy={loading}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => settle(false)}
            disabled={loading}
          >
            {current.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            variant={current.tone === "danger" ? "danger" : "primary"}
            onClick={handleConfirm}
            loading={loading}
          >
            {current.confirmLabel ?? "Confirm"}
          </Button>
        </>
      }
    >
      {current.details}
      {error && (
        <div className="mt-3 space-y-1">
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
          {process.env.NODE_ENV === "development" && (
            <p className="text-xs text-muted-foreground">
              {toTechnicalDetail(error)}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
