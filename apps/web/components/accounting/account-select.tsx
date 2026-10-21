"use client";

import { formatNaira, type AccountDto, type PaymentMethod } from "@fabtyna/shared";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/input";

export function defaultAccountId(
  accounts: readonly AccountDto[],
  method?: PaymentMethod,
): string {
  const active = accounts.filter((account) => account.isActive);
  const preferredType = method === "TRANSFER" ? "BANK" : "CASH";
  return (
    active.find((account) => account.type === preferredType)?.id ??
    active[0]?.id ??
    ""
  );
}

export function AccountSelect({
  id,
  label,
  accounts,
  accountId,
  onChange,
  method,
  disabled = false,
}: {
  id: string;
  label: "Received into" | "Paid from";
  accounts: readonly AccountDto[];
  accountId: string;
  onChange: (accountId: string) => void;
  method?: PaymentMethod;
  disabled?: boolean;
}) {
  const activeAccounts = accounts.filter((account) => account.isActive);
  const selectedId = accountId || defaultAccountId(activeAccounts, method);

  return (
    <FormField id={id} label={label}>
      {activeAccounts.length > 0 ? (
        <Select
          id={id}
          value={selectedId}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {activeAccounts.map((account) => {
            // The real API includes the current balance; the mock does not.
            const balance = (account as { balanceKobo?: string }).balanceKobo;
            return (
              <option key={account.id} value={account.id}>
                {account.name} ({account.type})
                {balance !== undefined ? ` — ${formatNaira(BigInt(balance))}` : ""}
              </option>
            );
          })}
        </Select>
      ) : (
        <p className="rounded-md border border-warning/40 bg-warning-surface p-3 text-sm text-warning">
          No active accounts. Add an account before recording this payment.
        </p>
      )}
    </FormField>
  );
}
