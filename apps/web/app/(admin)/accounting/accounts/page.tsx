"use client";

import { useState, type FormEvent } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import type { AccountStatementEntryDto } from "@/lib/api/accounting.api";
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
import { invalidateReportsAndBalances } from "@/lib/invalidate-after-write";
import { transferDraftError } from "@/lib/account-transfer";
import { useWriteFlow } from "@/hooks/use-write-flow";
import { WriteFlowStatus } from "@/components/write-flow-status";
import { isMockApiMode } from "@/lib/api";

type ManualType = Extract<
  AccountEntryType,
  "OWNER_CAPITAL" | "OTHER_INCOME" | "OWNER_DRAWING" | "BANK_OR_POS_CHARGE"
>;

type AccountOperation =
  | { kind: "create"; input: CreateAccountDto }
  | { kind: "update"; id: string; input: UpdateAccountDto }
  | { kind: "deactivate"; id: string; input: DeactivateAccountDto }
  | { kind: "reactivate"; id: string }
  | { kind: "opening"; input: CreateOpeningBalanceDto }
  | { kind: "reconcile"; input: ReconcileAccountDto; countedAmountKobo: string }
  | { kind: "transfer"; input: CreateAccountTransferDto }
  | { kind: "reverseTransfer"; id: string; reason: string }
  | { kind: "reverseEntry"; id: string; reason: string }
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

function displayedAccountBalance(
  account: AccountDto,
  entries: readonly AccountLedgerEntryDto[],
): bigint {
  const balanceKobo = (account as AccountDto & { balanceKobo?: string }).balanceKobo;
  return balanceKobo === undefined ? accountBalance(account.id, entries) : BigInt(balanceKobo);
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
  const writeFlow = useWriteFlow();
  const [lastOperation, setLastOperation] = useState<AccountOperation | null>(null);
  const [lastTransferId, setLastTransferId] = useState("");
  const [transferReversalReason, setTransferReversalReason] = useState("");
  const [entryReversalTarget, setEntryReversalTarget] = useState<AccountStatementEntryDto | null>(null);
  const [entryReversalReason, setEntryReversalReason] = useState("");
  const businessDate = getLagosBusinessDate();
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [fromDate, setFromDate] = useState(() => isMockApiMode ? "" : getLagosBusinessDate());
  const [toDate, setToDate] = useState(() => isMockApiMode ? "" : getLagosBusinessDate());
  const [createName, setCreateName] = useState("");
  const [createType, setCreateType] = useState<AccountDto["type"]>("CASH");
  const [createNote, setCreateNote] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editName, setEditName] = useState("");
  const [editNote, setEditNote] = useState("");
  const [openingAmount, setOpeningAmount] = useState("");
  const [reconcileCount, setReconcileCount] = useState("");
  const [reconcileReason, setReconcileReason] = useState("");
  const [transferFromChoice, setTransferFromChoice] = useState("");
  const [transferToId, setTransferToId] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [manualType, setManualType] = useState<ManualType>("OTHER_INCOME");
  const [manualAmount, setManualAmount] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [actionError, setActionError] = useState("");
  const [deactivateTarget, setDeactivateTarget] = useState<AccountDto | null>(null);
  const [deactivateReason, setDeactivateReason] = useState("");
  // MoneyInput keeps its own text, so clearing the page state is not enough to
  // clear what the box shows. Each form has its own counter; bumping one
  // remounts only that form's money box, so the other forms keep what you typed.
  const [resetKeys, setResetKeys] = useState({
    opening: 0,
    reconcile: 0,
    transfer: 0,
    manual: 0,
  });

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
    enabled: isMockApiMode && accounts.length > 0,
  });
  const entries = ledgerQuery.data ?? EMPTY_LEDGER_ENTRIES;
  const activeAccounts = accounts.filter((account) => account.isActive);
  const selectedAccount =
    accounts.find((account) => account.id === selectedAccountId) ??
    activeAccounts[0] ??
    accounts[0] ??
    null;
  const selectedBalance = selectedAccount
    ? displayedAccountBalance(selectedAccount, entries)
    : 0n;
  // The From selector shows the account whose statement is open until the
  // operator chooses another one. The same expression feeds the payload, so what
  // the operator sees and what is submitted cannot drift apart.
  const transferFromId = transferFromChoice || selectedAccount?.id || "";
  const transferFromAccount =
    accounts.find((account) => account.id === transferFromId) ?? null;
  const transferFromBalance = transferFromAccount
    ? displayedAccountBalance(transferFromAccount, entries)
    : 0n;
  const transferAmountKobo = /^[0-9]+$/.test(transferAmount)
    ? BigInt(transferAmount)
    : 0n;
  const statementQuery = useInfiniteQuery({
    queryKey: ["accounting", "statement", selectedAccount?.id ?? "", fromDate, toDate],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }): Promise<{
      entries: AccountStatementEntryDto[];
      openingBalanceKobo: string;
      closingBalanceKobo: string;
      nextCursor: string | null;
    }> => {
      if (!selectedAccount) {
        return { entries: [], openingBalanceKobo: "0", closingBalanceKobo: "0", nextCursor: null };
      }
      if (accountingApi.statementPage) {
        return accountingApi.statementPage(selectedAccount.id, {
          from: fromDate,
          to: toDate,
          cursor: pageParam,
        });
      }
      const rows = runningEntries(selectedAccount.id, entries, fromDate, toDate);
      return {
        entries: rows.map(({ entry, balanceKobo }) => ({
          id: entry.id,
          type: entry.type,
          amountKobo: entry.amountKobo,
          occurredAt: entry.occurredAt,
          note: entry.note,
          sourceDescription: ENTRY_LABELS[entry.type],
          isReversal: entry.reversesEntryId !== null,
          reversesEntryId: entry.reversesEntryId,
          reversedByEntryId: null,
          runningBalanceKobo: balanceKobo.toString(),
        })),
        openingBalanceKobo: "0",
        closingBalanceKobo: rows[0]?.balanceKobo.toString() ?? selectedBalance.toString(),
        nextCursor: null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: selectedAccount !== null && (!isMockApiMode || ledgerQuery.isSuccess),
  });
  const statementRows = statementQuery.data?.pages.flatMap((page) => page.entries) ?? [];
  const statementSummary = statementQuery.data?.pages[0];

  function bumpResetKey(form: keyof typeof resetKeys) {
    setResetKeys((current) => ({ ...current, [form]: current[form] + 1 }));
  }

  // Runs only after the server accepted the operation, so a refused or
  // unconfirmed submit keeps everything the operator typed.
  function resetFormAfter(operation: AccountOperation) {
    switch (operation.kind) {
      case "create":
        setCreateName("");
        setCreateNote("");
        break;
      case "update":
        setEditingId("");
        break;
      case "opening":
        setOpeningAmount("");
        bumpResetKey("opening");
        break;
      case "reconcile":
        setReconcileCount("");
        setReconcileReason("");
        bumpResetKey("reconcile");
        break;
      case "transfer":
        setTransferFromChoice("");
        setTransferToId("");
        setTransferAmount("");
        setTransferNote("");
        bumpResetKey("transfer");
        break;
      case "manual":
        setManualAmount("");
        setManualNote("");
        bumpResetKey("manual");
        break;
      case "reverseTransfer":
        setTransferReversalReason("");
        break;
      case "reverseEntry":
        setEntryReversalReason("");
        break;
      default:
        break;
    }
  }

  const operationMutation = useMutation({
    mutationFn: async (operation: AccountOperation): Promise<unknown | null> => {
      const isRetry = JSON.stringify(operation) === JSON.stringify(lastOperation);
      if (!isMockApiMode && writeFlow.status === "unknown" && !isRetry) return null;
      if (!isMockApiMode && writeFlow.status === "failed" && !isRetry) writeFlow.edit();
      setLastOperation(operation);
      const execute = async (key?: string): Promise<unknown> => {
        let value: unknown;
        switch (operation.kind) {
          case "create":
            value = await accountingApi.createAccount(operation.input, key);
            break;
          case "update":
            value = await accountingApi.updateAccount(operation.id, operation.input, key);
            break;
          case "deactivate":
            value = await accountingApi.deactivateAccount(operation.id, operation.input, key);
            break;
          case "reactivate":
            if (!accountingApi.reactivateAccount) throw new Error("Account reactivation is unavailable.");
            value = await accountingApi.reactivateAccount(operation.id, key);
            break;
          case "opening":
            value = await accountingApi.recordOpeningBalance(operation.input, key);
            break;
          case "reconcile":
            value = await accountingApi.reconcileAccount(
              operation.input,
              key,
              operation.countedAmountKobo,
            );
            break;
          case "transfer":
            value = await accountingApi.recordTransfer(operation.input, key);
            break;
          case "reverseTransfer":
            if (!accountingApi.reverseTransfer) throw new Error("Transfer reversal is unavailable.");
            value = await accountingApi.reverseTransfer(operation.id, operation.reason, key);
            break;
          case "reverseEntry":
            if (!accountingApi.reverseEntry) throw new Error("Entry reversal is unavailable.");
            value = await accountingApi.reverseEntry(operation.id, operation.reason, key);
            break;
          case "manual":
            value = await accountingApi.recordManualEntry(operation.input, key);
            break;
        }
        return value;
      };
      if (isMockApiMode) return (await execute()) ?? true;
      const result = await writeFlow.run(async (key) => ({ value: await execute(key) }));
      if (!result) return null;
      if (operation.kind === "transfer" && typeof result.value === "object" && result.value !== null && "id" in result.value) {
        setLastTransferId(String(result.value.id));
      }
      if (operation.kind === "reverseTransfer") setLastTransferId("");
      return result.value ?? true;
    },
    onSuccess: async (result, operation) => {
      if (result === null) return;
      setActionError("");
      setEntryReversalTarget(null);
      resetFormAfter(operation);
      await queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.accounting.accounts });
      void invalidateReportsAndBalances(queryClient);
      // The reconcile box starts at the ledger balance, so remount it once the
      // new balance has loaded.
      if (operation.kind === "reconcile") bumpResetKey("reconcile");
    },
  });

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError("");
    if (!isMockApiMode && accounts.some((account) => account.name.trim().toLocaleLowerCase() === createName.trim().toLocaleLowerCase())) {
      setActionError("An account with this name already exists. Choose a different name.");
      return;
    }
    operationMutation.mutate({
      kind: "create",
      input: {
        name: createName.trim(),
        type: createType,
        note: createNote.trim() || null,
      },
    });
  }

  function startEdit(account: AccountDto) {
    setEditingId(account.id);
    setEditName(account.name);
    setEditNote(account.note ?? "");
  }

  function submitEdit(event: FormEvent<HTMLFormElement>, account: AccountDto) {
    event.preventDefault();
    setActionError("");
    if (!isMockApiMode && accounts.some((candidate) => candidate.id !== account.id && candidate.name.trim().toLocaleLowerCase() === editName.trim().toLocaleLowerCase())) {
      setActionError("An account with this name already exists. Choose a different name.");
      return;
    }
    operationMutation.mutate({
      kind: "update",
      id: account.id,
      input: { name: editName.trim(), note: editNote.trim() || null },
    });
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
      countedAmountKobo: reconcileCount,
      input: {
        accountId: selectedAccount.id,
        deltaKobo: deltaKobo.toString(),
        note: reconcileReason.trim(),
        occurredAt: createLagosDateTime(businessDate).toISOString(),
      },
    });
  }

  function submitTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError("");
    const problem = transferDraftError({
      fromAccountId: transferFromId,
      toAccountId: transferToId,
      amountKobo: transferAmount,
    });
    if (problem !== null) {
      setActionError(problem);
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
  }

  function submitDeactivation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deactivateTarget) return;
    if (isMockApiMode && deactivateReason.trim() === "") {
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
      <WriteFlowStatus
        flow={writeFlow}
        onRetry={() => {
          if (lastOperation) operationMutation.mutate(lastOperation);
        }}
        checkHref="/accounting/accounts"
        checkLabel="Check accounts"
        showFieldErrors
      />
      {lastTransferId && (
        <Card>
          <CardHeader title="Reverse the recent account transfer" description="A transfer reversal appends exact opposite entries; it does not delete history." />
          <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <FormField id="transfer-reversal-reason" label="Reason">
              <Input
                id="transfer-reversal-reason"
                value={transferReversalReason}
                onChange={(event) => { writeFlow.edit(); setTransferReversalReason(event.target.value); }}
                maxLength={500}
              />
            </FormField>
            <Button
              variant="secondary"
              disabled={operationMutation.isPending || transferReversalReason.trim() === ""}
              loading={operationMutation.isPending}
              onClick={() => operationMutation.mutate({
                kind: "reverseTransfer",
                id: lastTransferId,
                reason: transferReversalReason.trim(),
              })}
            >
              Reverse transfer
            </Button>
          </CardBody>
        </Card>
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
                    kobo={displayedAccountBalance(account, entries)}
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
                          onChange={(event) => { writeFlow.edit(); setEditName(event.target.value); }}
                          required
                        />
                      </FormField>
                      {isMockApiMode && (
                        <FormField id={`account-note-${account.id}`} label="Note (optional)">
                          <Textarea
                            id={`account-note-${account.id}`}
                            value={editNote}
                            rows={2}
                            onChange={(event) => { writeFlow.edit(); setEditNote(event.target.value); }}
                          />
                        </FormField>
                      )}
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
                        {!isMockApiMode && !account.isActive && (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            loading={operationMutation.isPending}
                            disabled={operationMutation.isPending}
                            onClick={() => operationMutation.mutate({ kind: "reactivate", id: account.id })}
                          >
                            Reactivate
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
                    onChange={(event) => { writeFlow.edit(); setCreateName(event.target.value); }}
                    required
                  />
                </FormField>
                <FormField id="new-account-type" label="Type">
                  <Select
                    id="new-account-type"
                    value={createType}
                    onChange={(event) => { writeFlow.edit(); setCreateType(event.target.value as AccountDto["type"]); }}
                  >
                    <option value="CASH">Cash</option>
                    <option value="BANK">Bank</option>
                    <option value="POS">POS</option>
                  </Select>
                </FormField>
                {isMockApiMode && (
                  <FormField id="new-account-note" label="Note (optional)">
                    <Input
                      id="new-account-note"
                      value={createNote}
                      onChange={(event) => { writeFlow.edit(); setCreateNote(event.target.value); }}
                    />
                  </FormField>
                )}
                <div className="flex items-end">
                  <Button type="submit" loading={operationMutation.isPending}>
                    <Plus aria-hidden="true" className="h-4 w-4" />
                    Add account
                  </Button>
                </div>
              </form>
            </CardBody>
          </Card>

          {statementQuery.isError || (isMockApiMode && ledgerQuery.isError) ? (
            <ErrorState
              title="Account statements could not be loaded"
              message={toUserMessage(statementQuery.error ?? ledgerQuery.error)}
              onRetry={() => void (isMockApiMode && ledgerQuery.isError ? ledgerQuery.refetch() : statementQuery.refetch())}
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
                  {!isMockApiMode && statementSummary && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <p className="rounded-md bg-muted p-3 text-sm">
                        Opening balance: <Money kobo={statementSummary.openingBalanceKobo} />
                      </p>
                      <p className="rounded-md bg-muted p-3 text-sm">
                        Closing balance: <Money kobo={statementSummary.closingBalanceKobo} />
                      </p>
                    </div>
                  )}
                  {statementQuery.isPending ? (
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
                            <th className="py-2 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {statementRows.map((entry) => (
                            <tr key={entry.id} className="border-b border-border/60">
                              <td className="py-2.5 pr-3 whitespace-nowrap">
                                {entry.occurredAt ? formatLagosDateTime(entry.occurredAt) : "—"}
                              </td>
                              <td className="py-2.5 pr-3">
                                {entry.sourceDescription || ENTRY_LABELS[entry.type]}
                                {entry.reversesEntryId !== null && " (reversal)"}
                              </td>
                              <td className="max-w-xs py-2.5 pr-3 text-muted-foreground">
                                {entry.note ?? "—"}
                              </td>
                              <td className="py-2.5 pr-3 text-right">
                                <Money kobo={entry.amountKobo} />
                              </td>
                              <td className="py-2.5 text-right font-medium">
                                <Money kobo={entry.runningBalanceKobo} />
                              </td>
                              <td className="py-2.5 text-right">
                                {!isMockApiMode &&
                                  entry.reversesEntryId === null &&
                                  ["OWNER_CAPITAL", "OWNER_DRAWING", "OTHER_INCOME", "BANK_OR_POS_CHARGE"].includes(entry.type) && (
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      disabled={operationMutation.isPending}
                                      onClick={() => {
                                        setEntryReversalTarget(entry);
                                        setEntryReversalReason("");
                                      }}
                                    >
                                      Reverse
                                    </Button>
                                  )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {statementQuery.hasNextPage && (
                    <div className="flex justify-center">
                      <Button
                        variant="secondary"
                        loading={statementQuery.isFetchingNextPage}
                        onClick={() => void statementQuery.fetchNextPage()}
                      >
                        Load more entries
                      </Button>
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
                          key={`opening-${resetKeys.opening}`}
                          id="opening-balance"
                          label="Opening balance"
                          defaultValueKobo="0"
                          onKoboChange={(value) => { writeFlow.edit(); setOpeningAmount(value); }}
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
                          key={`reconcile-${resetKeys.reconcile}`}
                          id="reconcile-count"
                          label="Counted amount"
                          defaultValueKobo={selectedBalance.toString()}
                          onKoboChange={(value) => { writeFlow.edit(); setReconcileCount(value); }}
                        />
                        <FormField id="reconcile-reason" label="Reason">
                          <Textarea
                            id="reconcile-reason"
                            value={reconcileReason}
                            rows={2}
                            onChange={(event) => { writeFlow.edit(); setReconcileReason(event.target.value); }}
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
                            <>
                              <Select
                                id="transfer-from"
                                value={transferFromId}
                                onChange={(event) => { writeFlow.edit(); setTransferFromChoice(event.target.value); }}
                              >
                                {activeAccounts.map((account) => (
                                  <option key={account.id} value={account.id}>{account.name}</option>
                                ))}
                              </Select>
                              <p className="text-xs text-muted-foreground">
                                {transferFromAccount === null ? (
                                  "Choose the account the money leaves."
                                ) : (
                                  <>
                                    Balance:{" "}
                                    <Money
                                      kobo={transferFromBalance}
                                      tone="neutral"
                                      className="font-medium"
                                    />
                                  </>
                                )}
                              </p>
                            </>
                          </FormField>
                          <FormField id="transfer-to" label="To">
                            <Select
                              id="transfer-to"
                              value={transferToId}
                              onChange={(event) => { writeFlow.edit(); setTransferToId(event.target.value); }}
                            >
                              <option value="">Select account</option>
                              {activeAccounts.map((account) => (
                                // The From account stays in the list but cannot be
                                // picked, so a chosen option never vanishes from
                                // under the selection.
                                <option
                                  key={account.id}
                                  value={account.id}
                                  disabled={account.id === transferFromId}
                                >
                                  {account.name}
                                </option>
                              ))}
                            </Select>
                          </FormField>
                        </div>
                        <MoneyInput
                          key={`transfer-${resetKeys.transfer}`}
                          id="transfer-amount"
                          label="Amount"
                          defaultValueKobo="0"
                          onKoboChange={(value) => { writeFlow.edit(); setTransferAmount(value); }}
                        />
                        {transferFromAccount !== null && transferAmountKobo > transferFromBalance && (
                          <p role="status" className="text-sm text-warning">
                            More than the {transferFromAccount.name} balance of{" "}
                            <Money kobo={transferFromBalance} tone="neutral" className="font-medium" />
                            . Check the amount before you transfer.
                          </p>
                        )}
                        <FormField id="transfer-note" label="Note (optional)">
                          <Input
                            id="transfer-note"
                            value={transferNote}
                            onChange={(event) => { writeFlow.edit(); setTransferNote(event.target.value); }}
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
                            onChange={(event) => { writeFlow.edit(); setManualType(event.target.value as ManualType); }}
                          >
                            {MANUAL_TYPES.map((item) => (
                              <option key={item.value} value={item.value}>{item.label}</option>
                            ))}
                          </Select>
                        </FormField>
                        <MoneyInput
                          key={`manual-${resetKeys.manual}`}
                          id="manual-amount"
                          label="Amount"
                          defaultValueKobo="0"
                          onKoboChange={(value) => { writeFlow.edit(); setManualAmount(value); }}
                        />
                        <FormField id="manual-note" label="Description / reason">
                          <Textarea
                            id="manual-note"
                            value={manualNote}
                            rows={2}
                            onChange={(event) => { writeFlow.edit(); setManualNote(event.target.value); }}
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
                kobo={displayedAccountBalance(deactivateTarget, entries)}
                className="font-medium"
              />
            </p>
            {isMockApiMode && (
              <FormField id="deactivate-reason" label="Reason">
                <Textarea
                  id="deactivate-reason"
                  value={deactivateReason}
                  rows={3}
                  onChange={(event) => { writeFlow.edit(); setDeactivateReason(event.target.value); }}
                />
              </FormField>
            )}
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
      <Modal
        open={entryReversalTarget !== null}
        onClose={() => setEntryReversalTarget(null)}
        title="Reverse account movement"
        description="This appends an exact reversal. The original ledger entry remains unchanged."
        busy={operationMutation.isPending}
      >
        {entryReversalTarget && (
          <div className="space-y-4">
            <p className="text-sm">
              {ENTRY_LABELS[entryReversalTarget.type]} · <Money kobo={entryReversalTarget.amountKobo} />
            </p>
            <FormField id="entry-reversal-reason" label="Reason">
              <Textarea
                id="entry-reversal-reason"
                value={entryReversalReason}
                rows={3}
                maxLength={500}
                onChange={(event) => { writeFlow.edit(); setEntryReversalReason(event.target.value); }}
              />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={operationMutation.isPending} onClick={() => setEntryReversalTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={operationMutation.isPending || entryReversalReason.trim() === ""}
                loading={operationMutation.isPending}
                onClick={() => operationMutation.mutate({
                  kind: "reverseEntry",
                  id: entryReversalTarget.id,
                  reason: entryReversalReason.trim(),
                })}
              >
                Reverse entry
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}