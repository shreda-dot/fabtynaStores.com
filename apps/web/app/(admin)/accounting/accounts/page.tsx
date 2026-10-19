"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Plus, RefreshCw } from "lucide-react";
import {
  createLagosDateTime,
  formatLagosDateTime,
  getLagosBusinessDate,
  type AccountDto,
  type AccountEntryType,
  type AccountLedgerEntryDto,
  type CreateAccountDto,
  type CreateAccountTransferDto,
  type CreateOpeningBalanceDto,
  type DeactivateAccountDto,
  type ReconcileAccountDto,
  type UpdateAccountDto,
} from "@fabtyna/shared";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { accountingApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";

type ManualType = Extract<
  AccountEntryType,
  "OWNER_CAPITAL" | "OTHER_INCOME" | "OWNER_DRAWING" | "BANK_OR_POS_CHARGE"
>;

type AccountOperation =
  | { kind: "create"; input: CreateAccountDto }
  | { kind: "update"; id: string; input: UpdateAccountDto }
  | { kind: "deactivate"; id: string; input: DeactivateAccountDto }
  | { kind: "opening"; input: CreateOpeningBalanceDto }
  | { kind: "reconcile"; input: ReconcileAccountDto }
  | { kind: "transfer"; input: CreateAccountTransferDto }
  | {
      kind: "manual";
      input: {
        accountId: string;
        type: ManualType;
        amountKobo: string;
        note: string;
        occurredAt: string;
      };
    };

const EMPTY_ACCOUNTS: AccountDto[] = [];
const EMPTY_LEDGER_ENTRIES: AccountLedgerEntryDto[] = [];

const ENTRY_LABELS: Record<AccountEntryType, string> = {
  SALE_PAYMENT: "Sale payment",
  CUSTOMER_PAYMENT: "Customer debt payment",
  SUPPLIER_PAYMENT: "Supplier payment",
  PURCHASE_PAYMENT: "Supplier-less purchase payment",
  EXPENSE: "Expense",
  CUSTOMER_REFUND: "Customer refund",
  TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out",
  OWNER_CAPITAL: "Owner capital",
  OWNER_DRAWING: "Owner drawing",
  OTHER_INCOME: "Other income",
  BANK_OR_POS_CHARGE: "Bank / POS charge",
  ADJUSTMENT: "Adjustment",
  OPENING_BALANCE: "Opening balance",
  LOAN_DISBURSEMENT: "Loan received",
  LOAN_REPAYMENT: "Loan repayment",
};

const MANUAL_TYPES: { value: ManualType; label: string }[] = [
  { value: "OWNER_CAPITAL", label: "Owner puts money in" },
  { value: "OTHER_INCOME", label: "Other income" },
  { value: "OWNER_DRAWING", label: "Owner takes money out" },
  { value: "BANK_OR_POS_CHARGE", label: "Bank / POS charge" },
];

function accountBalance(
  accountId: string,
  entries: readonly AccountLedgerEntryDto[],
): bigint {
  return entries.reduce(
    (balance, entry) =>
      entry.accountId === accountId ? balance + BigInt(entry.amountKobo) : balance,
    0n,
  );
}

function runningEntries(
  accountId: string,
  entries: readonly AccountLedgerEntryDto[],
  from: string,
  to: string,
): { entry: AccountLedgerEntryDto; balanceKobo: bigint }[] {
  const ordered = entries
    .filter((entry) => entry.accountId === accountId)
    .slice()
    .sort(
      (a, b) =>
        new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    );
  let balanceKobo = 0n;
  const rows: { entry: AccountLedgerEntryDto; balanceKobo: bigint }[] = [];
  for (const entry of ordered) {
    balanceKobo += BigInt(entry.amountKobo);
    const date = getLagosBusinessDate(new Date(entry.occurredAt));
    if ((from === "" || date >= from) && (to === "" || date <= to)) {
      rows.push({ entry, balanceKobo });
    }
  }
  return rows.reverse();
}

export default function AccountsPage() {
  const queryClient = useQueryClient();
  const businessDate = getLagosBusinessDate();
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [createName, setCreateName] = useState("");
  const [createType, setCreateType] = useState<AccountDto["type"]>("CASH");
  const [createNote, setCreateNote] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editName, setEditName] = useState("");
  const [editNote, setEditNote] = useState("");
  const [openingAmount, setOpeningAmount] = useState("");
  const [reconcileCount, setReconcileCount] = useState("");
  const [reconcileReason, setReconcileReason] = useState("");
  const [transferFromId, setTransferFromId] = useState("");
  const [transferToId, setTransferToId] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [manualType, setManualType] = useState<ManualType>("OTHER_INCOME");
  const [manualAmount, setManualAmount] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [actionError, setActionError] = useState("");
  const [deactivateTarget, setDeactivateTarget] = useState<AccountDto | null>(null);
  const [deactivateReason, setDeactivateReason] = useState("");

  const accountsQuery = useQuery({
    queryKey: queryKeys.accounting.accounts,
    queryFn: () => accountingApi.listAccounts(),
  });
  const migrationNoticeQuery = useQuery({
    queryKey: queryKeys.accounting.migrationNotice,
    queryFn: () => accountingApi.getMigrationNotice(),
  });
  const dismissNoticeMutation = useMutation({
    mutationFn: (id: string) => accountingApi.dismissMigrationNotice(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.accounting.migrationNotice,
      });
    },
  });
  const accounts = accountsQuery.data ?? EMPTY_ACCOUNTS;
  const accountIds = accounts.map((account) => account.id).join(",");
  const ledgerQuery = useQuery({
    queryKey: ["accounting", "all-account-ledgers", accountIds],
    queryFn: async () => {
      const entries = await Promise.all(
        accounts.map((account) => accountingApi.listLedgerEntries(account.id)),
      );
      return entries.flat();
    },
    enabled: accounts.length > 0,
  });
  const entries = ledgerQuery.data ?? EMPTY_LEDGER_ENTRIES;
  const activeAccounts = accounts.filter((account) => account.isActive);
  const selectedAccount =
    accounts.find((account) => account.id === selectedAccountId) ??
    activeAccounts[0] ??
    accounts[0] ??
    null;
  const selectedBalance = selectedAccount
    ? accountBalance(selectedAccount.id, entries)
    : 0n;
  const statementRows = selectedAccount
    ? runningEntries(selectedAccount.id, entries, fromDate, toDate)
    : [];

  const operationMutation = useMutation({
    mutationFn: async (operation: AccountOperation): Promise<unknown> => {
      switch (operation.kind) {
        case "create":
          return accountingApi.createAccount(operation.input);
        case "update":
          return accountingApi.updateAccount(operation.id, operation.input);
        case "deactivate":
          return accountingApi.deactivateAccount(operation.id, operation.input);
        case "opening":
          return accountingApi.recordOpeningBalance(operation.input);
        case "reconcile":
          return accountingApi.reconcileAccount(operation.input);
        case "transfer":
          return accountingApi.recordTransfer(operation.input);
        case "manual":
          return accountingApi.recordManualEntry(operation.input);
      }
    },
    onSuccess: async () => {
      setActionError("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
    },
    onError: (error) => setActionError(toUserMessage(error)),
  });

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError("");
    operationMutation.mutate({
      kind: "create",
      input: {
        name: createName.trim(),
        type: createType,
        note: createNote.trim() || null,
      },
    });
    setCreateName("");
    setCreateNote("");
  }

  function startEdit(account: AccountDto) {
    setEditingId(account.id);
    setEditName(account.name);
    setEditNote(account.note ?? "");
  }

  function submitEdit(event: FormEvent<HTMLFormElement>, account: AccountDto) {
    event.preventDefault();
    setActionError("");
    operationMutation.mutate({
      kind: "update",
      id: account.id,
      input: { name: editName.trim(), note: editNote.trim() || null },
    });
    setEditingId("");
  }

  function submitOpening(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError("");
    if (!selectedAccount || openingAmount.trim() === "") return;
    operationMutation.mutate({
      kind: "opening",
      input: {
        accountId: selectedAccount.id,
        amountKobo: openingAmount,
        note: null,
        occurredAt: createLagosDateTime(businessDate).toISOString(),
      },
    });
    setOpeningAmount("");
  }

  function submitReconcile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError("");
    if (!selectedAccount || !/^[0-9]+$/.test(reconcileCount)) {
      setActionError("Enter the counted balance.");
      return;
    }
    const deltaKobo = BigInt(reconcileCount) - selectedBalance;
    if (deltaKobo === 0n) {
      setActionError("The counted balance already matches the ledger.");
      return;
    }
    if (reconcileReason.trim() === "") {
      setActionError("Enter a reason for the reconciliation.");
      return;
    }
    operationMutation.mutate({
      kind: "reconcile",
      input: {
        accountId: selectedAccount.id,
        deltaKobo: deltaKobo.toString(),
        note: reconcileReason.trim(),
        occurredAt: createLagosDateTime(businessDate).toISOString(),
      },
    });
    setReconcileCount("");
    setReconcileReason("");
  }

  function submitTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError("");
    if (!/^[0-9]+$/.test(transferAmount) || BigInt(transferAmount) <= 0n) {
      setActionError("Enter an amount greater than zero.");
      return;
    }
    operationMutation.mutate({
      kind: "transfer",
      input: {
        fromAccountId: transferFromId,
        toAccountId: transferToId,
        amountKobo: transferAmount,
        note: transferNote.trim() || null,
        occurredAt: createLagosDateTime(businessDate).toISOString(),
      },
    });
    setTransferAmount("");
    setTransferNote("");
  }

  function submitManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError("");
    if (!selectedAccount) return;
    if (!/^[0-9]+$/.test(manualAmount) || BigInt(manualAmount) <= 0n) {
      setActionError("Enter an amount greater than zero.");
      return;
    }
    if (manualNote.trim() === "") {
      setActionError("Enter a description or reason.");
      return;
    }
    operationMutation.mutate({
      kind: "manual",
      input: {
        accountId: selectedAccount.id,
        type: manualType,
        amountKobo: manualAmount,
        note: manualNote.trim(),
        occurredAt: createLagosDateTime(businessDate).toISOString(),
      },
    });
    setManualAmount("");
    setManualNote("");
  }

  function submitDeactivation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deactivateTarget) return;
    if (deactivateReason.trim() === "") {
      setActionError("Enter a reason for deactivating this account.");
      return;
    }
    operationMutation.mutate({
      kind: "deactivate",
      id: deactivateTarget.id,
      input: { reason: deactivateReason.trim() },
    });
    setDeactivateTarget(null);
    setDeactivateReason("");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounts"
        description="Manage the places your business keeps money. Balances come only from account ledger entries."
      />

      {migrationNoticeQuery.isError && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-surface p-3 text-sm text-danger">
          The account migration reminder could not be loaded: {toUserMessage(migrationNoticeQuery.error)}
        </p>
      )}
      {migrationNoticeQuery.data && (
        <section
          role="status"
          className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning-surface p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <h2 className="font-semibold">{migrationNoticeQuery.data.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {migrationNoticeQuery.data.message}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={dismissNoticeMutation.isPending}
            onClick={() => dismissNoticeMutation.mutate(migrationNoticeQuery.data!.id)}
          >
            I’ve reconciled
          </Button>
        </section>
      )}
      {dismissNoticeMutation.isError && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-surface p-3 text-sm text-danger">
          The reminder could not be acknowledged: {toUserMessage(dismissNoticeMutation.error)}
        </p>
      )}

      {operationMutation.isError && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-surface p-3 text-sm text-danger">
          {actionError || toUserMessage(operationMutation.error)}
        </p>
      )}

      {accountsQuery.isPending ? (
        <Skeleton variant="card" count={2} />
      ) : accountsQuery.isError ? (
        <ErrorState
          title="Accounts could not be loaded"
          message={toUserMessage(accountsQuery.error)}
          onRetry={() => void accountsQuery.refetch()}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {accounts.map((account) => (
              <Card key={account.id}>
                <CardHeader
                  title={account.name}
                  description={`${account.type} · ${account.isActive ? "Active" : "Deactivated"}`}
                  action={
                    <Money
                      kobo={accountBalance(account.id, entries)}
                      className="text-lg font-semibold"
                    />
                  }
                />
                <CardBody className="space-y-3">
                  {editingId === account.id ? (
                    <form
                      onSubmit={(event) => submitEdit(event, account)}
                      className="space-y-3"
                    >
                      <FormField id={`account-name-${account.id}`} label="Account name">
                        <Input
                          id={`account-name-${account.id}`}
                          value={editName}
                          onChange={(event) => setEditName(event.target.value)}
                          required
                        />
                      </FormField>
                      <FormField id={`account-note-${account.id}`} label="Note (optional)">
                        <Textarea
                          id={`account-note-${account.id}`}
                          value={editNote}
                          rows={2}
                          onChange={(event) => setEditNote(event.target.value)}
                        />
                      </FormField>
                      <div className="flex gap-2">
                        <Button type="submit" size="sm" loading={operationMutation.isPending}>
                          Save
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => setEditingId("")}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <>
                      {account.note && (
                        <p className="text-sm text-muted-foreground">{account.note}</p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => setSelectedAccountId(account.id)}
                        >
                          Statement
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => startEdit(account)}
                          disabled={operationMutation.isPending}
                        >
                          Rename
                        </Button>
                        {account.isActive && (
                          <Button
                            type="button"
                            size="sm"
                            variant="danger"
                            onClick={() => {
                              setDeactivateTarget(account);
                              setActionError("");
                            }}
                            disabled={operationMutation.isPending}
                          >
                            Deactivate
                          </Button>
                        )}
                      </div>
                    </>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader title="Add account" description="For example, a cash drawer, bank account or POS settlement account." />
            <CardBody>
              <form onSubmit={submitCreate} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <FormField id="new-account-name" label="Name">
                  <Input
                    id="new-account-name"
                    value={createName}
                    onChange={(event) => setCreateName(event.target.value)}
                    required
                  />
                </FormField>
                <FormField id="new-account-type" label="Type">
                  <Select
                    id="new-account-type"
                    value={createType}
                    onChange={(event) => setCreateType(event.target.value as AccountDto["type"])}
                  >
                    <option value="CASH">Cash</option>
                    <option value="BANK">Bank</option>
                    <option value="POS">POS</option>
                  </Select>
                </FormField>
                <FormField id="new-account-note" label="Note (optional)">
                  <Input
                    id="new-account-note"
                    value={createNote}
                    onChange={(event) => setCreateNote(event.target.value)}
                  />
                </FormField>
                <div className="flex items-end">
                  <Button type="submit" loading={operationMutation.isPending}>
                    <Plus aria-hidden="true" className="h-4 w-4" />
                    Add account
                  </Button>
                </div>
              </form>
            </CardBody>
          </Card>

          {ledgerQuery.isError ? (
            <ErrorState
              title="Account statements could not be loaded"
              message={toUserMessage(ledgerQuery.error)}
              onRetry={() => void ledgerQuery.refetch()}
            />
          ) : (
            <>
              <Card>
                <CardHeader
                  title={selectedAccount ? `${selectedAccount.name} statement` : "Account statement"}
                  description="Running balances are computed chronologically from immutable entries."
                />
                <CardBody className="space-y-4">
                  {selectedAccount && (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <FormField id="statement-account" label="Account">
                        <Select
                          id="statement-account"
                          value={selectedAccount.id}
                          onChange={(event) => setSelectedAccountId(event.target.value)}
                        >
                          {accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name}{account.isActive ? "" : " (deactivated)"}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                      <FormField id="statement-from" label="From">
                        <Input
                          id="statement-from"
                          type="date"
                          value={fromDate}
                          max={businessDate}
                          onChange={(event) => setFromDate(event.target.value)}
                        />
                      </FormField>
                      <FormField id="statement-to" label="To">
                        <Input
                          id="statement-to"
                          type="date"
                          value={toDate}
                          max={businessDate}
                          min={fromDate || undefined}
                          onChange={(event) => setToDate(event.target.value)}
                        />
                      </FormField>
                    </div>
                  )}
                  {ledgerQuery.isPending ? (
                    <Skeleton variant="row" count={4} />
                  ) : statementRows.length === 0 ? (
                    <EmptyState
                      icon={Banknote}
                      title="No account entries in this range"
                      description="Opening balances, payments, expenses, transfers and adjustments will appear here."
                    />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[38rem] text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-muted-foreground">
                            <th className="py-2 pr-3">Date</th>
                            <th className="py-2 pr-3">Entry</th>
                            <th className="py-2 pr-3">Note</th>
                            <th className="py-2 pr-3 text-right">Amount</th>
                            <th className="py-2 text-right">Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {statementRows.map(({ entry, balanceKobo }) => (
                            <tr key={entry.id} className="border-b border-border/60">
                              <td className="py-2.5 pr-3 whitespace-nowrap">
                                {formatLagosDateTime(entry.occurredAt)}
                              </td>
                              <td className="py-2.5 pr-3">
                                {ENTRY_LABELS[entry.type]}
                                {entry.reversesEntryId !== null && " (reversal)"}
                              </td>
                              <td className="max-w-xs py-2.5 pr-3 text-muted-foreground">
                                {entry.note ?? "—"}
                              </td>
                              <td className="py-2.5 pr-3 text-right">
                                <Money kobo={entry.amountKobo} />
                              </td>
                              <td className="py-2.5 text-right font-medium">
                                <Money kobo={balanceKobo} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardBody>
              </Card>

              {selectedAccount?.isActive && (
                <div className="grid gap-6 xl:grid-cols-2">
                  <Card>
                    <CardHeader
                      title="Opening balance"
                      description="Enter the amount this account held when you started tracking it. This can only be set once."
                    />
                    <CardBody>
                      <form onSubmit={submitOpening} className="space-y-3">
                        <MoneyInput
                          id="opening-balance"
                          label="Opening balance"
                          defaultValueKobo="0"
                          onKoboChange={setOpeningAmount}
                        />
                        <Button
                          type="submit"
                          variant="secondary"
                          loading={operationMutation.isPending}
                          disabled={!selectedAccount}
                        >
                          Record opening balance
                        </Button>
                      </form>
                    </CardBody>
                  </Card>

                  <Card>
                    <CardHeader
                      title="Reconcile counted balance"
                      description={
                        <>Ledger balance: <Money kobo={selectedBalance} tone="neutral" /></>
                      }
                    />
                    <CardBody>
                      <form onSubmit={submitReconcile} className="space-y-3">
                        <MoneyInput
                          id="reconcile-count"
                          label="Counted amount"
                          defaultValueKobo={selectedBalance.toString()}
                          onKoboChange={setReconcileCount}
                        />
                        <FormField id="reconcile-reason" label="Reason">
                          <Textarea
                            id="reconcile-reason"
                            value={reconcileReason}
                            rows={2}
                            onChange={(event) => setReconcileReason(event.target.value)}
                          />
                        </FormField>
                        <Button
                          type="submit"
                          variant="secondary"
                          loading={operationMutation.isPending}
                        >
                          <RefreshCw aria-hidden="true" className="h-4 w-4" />
                          Post adjustment
                        </Button>
                      </form>
                    </CardBody>
                  </Card>

                  <Card>
                    <CardHeader title="Transfer between accounts" description="Moves money out of one account and into another." />
                    <CardBody>
                      <form onSubmit={submitTransfer} className="space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <FormField id="transfer-from" label="From">
                            <Select
                              id="transfer-from"
                              value={transferFromId || selectedAccount.id}
                              onChange={(event) => setTransferFromId(event.target.value)}
                            >
                              {activeAccounts.map((account) => (
                                <option key={account.id} value={account.id}>{account.name}</option>
                              ))}
                            </Select>
                          </FormField>
                          <FormField id="transfer-to" label="To">
                            <Select
                              id="transfer-to"
                              value={transferToId}
                              onChange={(event) => setTransferToId(event.target.value)}
                            >
                              <option value="">Select account</option>
                              {activeAccounts.filter((account) => account.id !== (transferFromId || selectedAccount.id)).map((account) => (
                                <option key={account.id} value={account.id}>{account.name}</option>
                              ))}
                            </Select>
                          </FormField>
                        </div>
                        <MoneyInput
                          id="transfer-amount"
                          label="Amount"
                          defaultValueKobo="0"
                          onKoboChange={setTransferAmount}
                        />
                        <FormField id="transfer-note" label="Note (optional)">
                          <Input
                            id="transfer-note"
                            value={transferNote}
                            onChange={(event) => setTransferNote(event.target.value)}
                          />
                        </FormField>
                        <Button type="submit" variant="secondary" loading={operationMutation.isPending}>
                          Transfer
                        </Button>
                      </form>
                    </CardBody>
                  </Card>

                  <Card>
                    <CardHeader title="Other money movement" description="Record owner capital, drawings, other income or bank/POS charges." />
                    <CardBody>
                      <form onSubmit={submitManual} className="space-y-3">
                        <FormField id="manual-type" label="Movement">
                          <Select
                            id="manual-type"
                            value={manualType}
                            onChange={(event) => setManualType(event.target.value as ManualType)}
                          >
                            {MANUAL_TYPES.map((item) => (
                              <option key={item.value} value={item.value}>{item.label}</option>
                            ))}
                          </Select>
                        </FormField>
                        <MoneyInput
                          id="manual-amount"
                          label="Amount"
                          defaultValueKobo="0"
                          onKoboChange={setManualAmount}
                        />
                        <FormField id="manual-note" label="Description / reason">
                          <Textarea
                            id="manual-note"
                            value={manualNote}
                            rows={2}
                            onChange={(event) => setManualNote(event.target.value)}
                          />
                        </FormField>
                        <Button type="submit" variant="secondary" loading={operationMutation.isPending}>
                          Record movement
                        </Button>
                      </form>
                    </CardBody>
                  </Card>
                </div>
              )}
            </>
          )}
        </>
      )}

      <Modal
        open={deactivateTarget !== null}
        onClose={() => setDeactivateTarget(null)}
        title="Deactivate account"
        description="An account can only be deactivated when its balance is exactly zero. Accounts are never deleted."
        busy={operationMutation.isPending}
      >
        {deactivateTarget && (
          <form onSubmit={submitDeactivation} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {deactivateTarget.name} balance:{" "}
              <Money
                kobo={accountBalance(deactivateTarget.id, entries)}
                className="font-medium"
              />
            </p>
            <FormField id="deactivate-reason" label="Reason">
              <Textarea
                id="deactivate-reason"
                value={deactivateReason}
                rows={3}
                onChange={(event) => setDeactivateReason(event.target.value)}
              />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={operationMutation.isPending}
                onClick={() => setDeactivateTarget(null)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="danger" loading={operationMutation.isPending}>
                Deactivate account
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
