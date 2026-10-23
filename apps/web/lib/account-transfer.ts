/**
 * Client-side gate for the account transfer form.
 *
 * Returns the message to show, or `null` when the draft is worth sending. The
 * API re-validates every field, so this exists to replace the server's
 * field-level text ("fromAccountId: too small…") with plain wording and to stop
 * a request that cannot succeed.
 */
export interface TransferDraft {
  fromAccountId: string;
  toAccountId: string;
  /** Integer kobo, as the form stores it. */
  amountKobo: string;
}

export function transferDraftError(draft: TransferDraft): string | null {
  if (draft.fromAccountId === "") return "Choose the account to transfer from";
  if (draft.toAccountId === "") return "Choose the account to transfer to";
  if (draft.fromAccountId === draft.toAccountId) {
    return "From and To must be different accounts";
  }
  if (!/^[0-9]+$/.test(draft.amountKobo) || BigInt(draft.amountKobo) <= 0n) {
    return "Enter an amount greater than zero";
  }
  return null;
}
