"use client";

import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatLagosDateTime, formatNaira, getLagosBusinessDate } from "@fabtyna/shared";
import { AccountSelect, defaultAccountId } from "@/components/accounting/account-select";
import { DateRangeFilter, defaultListRange } from "@/components/date-range-filter";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { WriteFlowStatus } from "@/components/write-flow-status";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { useWriteFlow } from "@/hooks/use-write-flow";
import { accountingApi, emptiesApi, isMockApiMode } from "@/lib/api";
import type {
  CreateEmptiesDepositInput,
  EmptiesDepositDto,
  EmptiesDepositMovementType,
} from "@/lib/api/empties.api";
import { toUserMessage } from "@/lib/api/client";
import { parseEmptiesQuantityText } from "@/lib/empties-quantity";
import { queryKeys } from "@/lib/query-keys";
import { validateReportRange } from "@/lib/report-range";

const PAGE_SIZE = 25;

const ACTIONS: Array<{ type: EmptiesDepositMovementType; label: string }> = [
  { type: "RECEIVED", label: "Customer paid a deposit" },
  { type: "REFUNDED", label: "Refund deposit" },
  { type: "FORFEITED", label: "Forfeit deposit (customer keeps the crates)" },
];

const HISTORY_LABEL: Record<EmptiesDepositMovementType, string> = {
  RECEIVED: "Deposit received",
  REFUNDED: "Deposit refunded",
  FORFEITED: "Deposit forfeited",
};

const MESSAGE_KEY = {
  RECEIVED: "empties.deposit.received",
  REFUNDED: "empties.deposit.refunded",
  FORFEITED: "empties.deposit.forfeited",
} as const;

/** Whole-kobo check shared by the form and tests. */
export function parseDepositAmountKobo(text: string): bigint | null {
  return /^[1-9]\d*$/.test(text.trim()) ? BigInt(text.trim()) : null;
}

export function CustomerDepositSection({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string;
}) {
  const queryClient = useQueryClient();
  const network = useNetworkStatus();
  const [movementType, setMovementType] = useState<EmptiesDepositMovementType>("RECEIVED");
  const [amountKobo, setAmountKobo] = useState("");
  const [amountVersion, setAmountVersion] = useState(0);
  const [note, setNote] = useState("");
  const [typeId, setTypeId] = useState("");
  const [quantityText, setQuantityText] = useState("");
  const [accountId, setAccountId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [formError, setFormError] = useState("");
  const [lastInput, setLastInput] = useState<CreateEmptiesDepositInput | null>(null);
  const [reverseTarget, setReverseTarget] = useState<EmptiesDepositDto | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [range, setRange] = useState(() => defaultListRange(getLagosBusinessDate()));
  const rangeProblem = validateReportRange(range.from, range.to);
  const flow = useWriteFlow();
  const reverseFlow = useWriteFlow();

  const held = useQuery({
    queryKey: queryKeys.empties.depositBalances({ customerId }),
    queryFn: () => emptiesApi.listDepositBalances({ q: customerName, onlyHolding: true, limit: 200 }),
    enabled: !isMockApiMode,
  });
  const owed = useQuery({
    queryKey: queryKeys.empties.customerBalances({ customerId, onlyOwing: true }),
    queryFn: () => emptiesApi.listCustomerBalances({ customerId, onlyOwing: true, limit: 200 }),
    enabled: !isMockApiMode,
  });
  const accounts = useQuery({
    queryKey: queryKeys.accounting.accounts,
    queryFn: () => accountingApi.listAccounts(),
    enabled: !isMockApiMode,
  });
  const history = useInfiniteQuery({
    queryKey: queryKeys.empties.depositPages({ customerId, from: range.from, to: range.to }),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      emptiesApi.listDeposits({ customerId, from: range.from, to: range.to, limit: PAGE_SIZE, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !isMockApiMode && rangeProblem === null,
  });

  const heldKobo = BigInt(held.data?.items.find((item) => item.customerId === customerId)?.heldKobo ?? "0");
  const owedRows = owed.data?.items ?? [];
  const selectedType = owedRows.find((row) => row.typeId === typeId) ?? owedRows[0];
  const entries = history.data?.pages.flatMap((page) => page.items) ?? [];

  const createMutation = useMutation({
    mutationFn: (input: CreateEmptiesDepositInput) => {
      const isRetry = JSON.stringify(input) === JSON.stringify(lastInput);
      if (flow.status === "unknown" && !isRetry) return Promise.resolve(undefined);
      if (flow.status === "failed" && !isRetry) flow.edit();
      setLastInput(input);
      return flow.run(MESSAGE_KEY[input.movementType], (key) => emptiesApi.createDeposit(input, key), {
        name: customerName,
      });
    },
    onSuccess: async (result) => {
      if (!result) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.empties.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.accounting.accounts });
      setAmountKobo("");
      setAmountVersion((value) => value + 1);
      setNote("");
      setQuantityText("");
      setConfirming(false);
      setLastInput(null);
      flow.reset();
    },
  });

  const reverseMutation = useMutation({
    mutationFn: (operation: { entry: EmptiesDepositDto; reason: string }) =>
      reverseFlow.run("empties.deposit.reverse", (key) =>
        emptiesApi.reverseDeposit(operation.entry.id, operation.reason, key),
      ),
    onSuccess: async (result) => {
      if (!result) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.empties.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.accounting.accounts });
      setReverseTarget(null);
      setReverseReason("");
      reverseFlow.reset();
    },
  });

  function buildInput(): CreateEmptiesDepositInput | null {
    const amount = parseDepositAmountKobo(amountKobo);
    if (amount === null) {
      setFormError("Enter the deposit amount in naira.");
      return null;
    }
    if (movementType !== "RECEIVED" && amount > heldKobo) {
      setFormError(`${customerName} holds only ${formatNaira(heldKobo)} of deposit.`);
      return null;
    }
    const base = { customerId, movementType, amountKobo: amount.toString(), note: note.trim() || undefined };
    if (movementType !== "FORFEITED") return base;
    if (owed.isPending) {
      setFormError("Customer crate balances are still loading. Please wait and try again.");
      return null;
    }
    if (owed.isError) {
      setFormError("Customer crate balances could not be loaded. Retry the crate balance request first.");
      return null;
    }
    if (owedRows.length === 0) {
      setFormError("This customer has no crates recorded as owed. Record crates taken before forfeiting a deposit.");
      return null;
    }
    const type = selectedType;
    if (type === undefined) {
      setFormError("Choose the crate type the customer is keeping.");
      return null;
    }
    if (note.trim() === "") {
      setFormError("Add a short note, for example why the crates were not returned.");
      return null;
    }
    const parsed = parseEmptiesQuantityText(quantityText);
    if (!parsed.ok) {
      setFormError(parsed.message);
      return null;
    }
    if (parsed.quantity > type.quantity) {
      setFormError(`${customerName} owes only ${type.quantity} of '${type.label}'.`);
      return null;
    }
    const toAccountId = accountId || defaultAccountId(accounts.data ?? []);
    if (!toAccountId) {
      setFormError("Choose the account that receives the money.");
      return null;
    }
    return { ...base, typeId: type.typeId, quantity: parsed.quantity, toAccountId };
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const input = buildInput();
    if (input === null) return;
    if (movementType === "REFUNDED" && !confirming) {
      setConfirming(true);
      return;
    }
    createMutation.mutate(input);
  }

  if (isMockApiMode) {
    return <p className="text-sm text-muted-foreground">Not available with demo data.</p>;
  }

  return (
    <details className="rounded-md border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Deposit {held.isSuccess ? `(holding ${formatNaira(heldKobo)})` : ""}
      </summary>
      <div className="mt-3 space-y-4">
        <p className="text-sm text-muted-foreground">
          A deposit is held for the customer. It is not sales or profit, and it stays out of your business cash until
          it is forfeited.
        </p>
        <form className="space-y-3" onSubmit={submit}>
          <FormField id="deposit-action" label="Action">
            <Select
              id="deposit-action"
              value={movementType}
              onChange={(event) => {
                flow.edit();
                setConfirming(false);
                const next = event.target.value as EmptiesDepositMovementType;
                setMovementType(next);
                setAmountKobo(next === "REFUNDED" ? heldKobo.toString() : "");
                setAmountVersion((value) => value + 1);
              }}
            >
              {ACTIONS.map((action) => (
                <option key={action.type} value={action.type}>
                  {action.label}
                </option>
              ))}
            </Select>
          </FormField>
          <MoneyInput
            key={`${movementType}-${amountVersion}`}
            id="deposit-amount"
            label="Amount"
            defaultValueKobo={amountKobo || "0"}
            onKoboChange={(value) => {
              flow.edit();
              setConfirming(false);
              setAmountKobo(value);
            }}
          />
          {movementType === "FORFEITED" && (
            <>
              {owed.isPending ? (
                <Skeleton variant="row" count={2} />
              ) : owed.isError ? (
                <ErrorState message={toUserMessage(owed.error)} onRetry={() => void owed.refetch()} />
              ) : owedRows.length === 0 ? (
                <EmptyState
                  title="No crates recorded as owed"
                  description="Record crates taken by this customer before forfeiting a deposit. Forfeiture reduces the customer's recorded crate balance."
                />
              ) : (
                <>
                  <FormField id="deposit-crate-type" label="Crate type">
                    <Select
                      id="deposit-crate-type"
                      value={typeId || owedRows[0]?.typeId || ""}
                      onChange={(event) => setTypeId(event.target.value)}
                    >
                      <option value="">Choose a crate type</option>
                      {owedRows.map((row) => (
                        <option key={row.typeId} value={row.typeId}>
                          {row.label} ({row.ownerName}) - owes {row.quantity}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField
                    id="deposit-quantity"
                    label="Crates the customer keeps"
                    hint={`Enter a whole number from 1 to ${selectedType?.quantity ?? 0}.`}
                  >
                    <Input
                      id="deposit-quantity"
                      inputMode="numeric"
                      placeholder="e.g. 3"
                      value={quantityText}
                      onChange={(event) => {
                        flow.edit();
                        setQuantityText(event.target.value);
                      }}
                    />
                  </FormField>
                  <AccountSelect
                    id="deposit-forfeit-account"
                    label="Received into"
                    accounts={accounts.data ?? []}
                    accountId={accountId}
                    onChange={setAccountId}
                    disabled={accounts.isPending || accounts.isError}
                  />
                </>
              )}
            </>
          )}
          <FormField
            id="deposit-note"
            label={movementType === "FORFEITED" ? "Note" : "Note (optional)"}
            required={movementType === "FORFEITED"}
          >
            <Textarea
              id="deposit-note"
              value={note}
              onChange={(event) => {
                flow.edit();
                setNote(event.target.value);
              }}
              maxLength={500}
              rows={2}
            />
          </FormField>
          {formError && (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          )}
          {confirming && movementType === "REFUNDED" && (
            <p className="rounded-md bg-muted p-3 text-sm">
              Refund {formatNaira(BigInt(amountKobo || "0"))} to {customerName}? The money leaves the deposit holding
              account.
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending} disabled={network.offline}>
            {confirming ? "Yes, refund" : movementType === "RECEIVED" ? "Record deposit" : movementType === "REFUNDED" ? "Refund" : "Forfeit deposit"}
          </Button>
          <WriteFlowStatus
            flow={flow}
            onRetry={() => {
              if (lastInput) createMutation.mutate(lastInput);
            }}
            checkHref={`/customers/${customerId}`}
            checkLabel="Check customer deposit"
            showFieldErrors
          />
        </form>

        <div className="space-y-3">
          <p className="text-sm font-medium">Deposit history</p>
          <DateRangeFilter
            idPrefix="customer-deposit"
            from={range.from}
            to={range.to}
            today={getLagosBusinessDate()}
            onChange={setRange}
            problem={rangeProblem}
          />
          {rangeProblem !== null ? null : history.isPending ? (
            <Skeleton variant="row" count={2} />
          ) : history.isError ? (
            <ErrorState message={toUserMessage(history.error)} onRetry={() => void history.refetch()} />
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deposit activity in this period.</p>
          ) : (
            <ul className="space-y-2">
              {entries.map((entry) => (
                <li key={entry.id} className="space-y-2 rounded-md bg-muted p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {entry.reversesEntryId ? "Reversal - " : ""}
                      {HISTORY_LABEL[entry.movementType]}
                    </span>
                    <span className="tabular">{formatNaira(BigInt(entry.amountKobo))}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatLagosDateTime(entry.occurredAt)}
                    {entry.crateQuantity ? ` - ${Math.abs(entry.crateQuantity)} x ${entry.crateLabel ?? "crates"}` : ""}
                    {entry.note ? ` - ${entry.note}` : ""}
                  </p>
                  {entry.reversesEntryId === null && entry.reversedByEntryId === null ? (
                    <Button variant="secondary" size="sm" onClick={() => setReverseTarget(entry)}>
                      Reverse
                    </Button>
                  ) : entry.reversedByEntryId !== null ? (
                    <p className="text-xs text-muted-foreground">Reversed</p>
                  ) : null}
                  {reverseTarget?.id === entry.id && (
                    <form
                      className="space-y-2 border-t border-border pt-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (reverseReason.trim()) reverseMutation.mutate({ entry, reason: reverseReason.trim() });
                      }}
                    >
                      <FormField id={`deposit-reverse-${entry.id}`} label="Reason for reversal" required>
                        <Textarea
                          id={`deposit-reverse-${entry.id}`}
                          value={reverseReason}
                          onChange={(event) => {
                            reverseFlow.edit();
                            setReverseReason(event.target.value);
                          }}
                          maxLength={500}
                          rows={2}
                        />
                      </FormField>
                      <div className="flex gap-2">
                        <Button
                          type="submit"
                          variant="danger"
                          loading={reverseMutation.isPending}
                          disabled={network.offline || reverseReason.trim() === ""}
                        >
                          Reverse entry
                        </Button>
                        <Button type="button" variant="secondary" onClick={() => setReverseTarget(null)}>
                          Cancel
                        </Button>
                      </div>
                      <WriteFlowStatus
                        flow={reverseFlow}
                        onRetry={() => {
                          if (reverseTarget) reverseMutation.mutate({ entry: reverseTarget, reason: reverseReason.trim() });
                        }}
                        checkHref={`/customers/${customerId}`}
                        checkLabel="Check customer deposit"
                        showFieldErrors
                      />
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          {history.hasNextPage && (
            <div className="flex justify-center">
              <Button variant="secondary" loading={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
                Load more
              </Button>
            </div>
          )}
        </div>
      </div>
    </details>
  );
}
