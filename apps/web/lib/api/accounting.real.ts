import type {
  AccountEntryType,
  AccountLedgerEntryDto,
  CreateAccountDto,
  CreateAccountTransferDto,
  CreateOpeningBalanceDto,
  DeactivateAccountDto,
  ReconcileAccountDto,
  UpdateAccountDto,
} from "@fabtyna/shared";
import { requestJson } from "./client";
import type {
  AccountRecordDto,
  AccountStatementPageDto,
  AccountingApi,
} from "./accounting.api";

const idPath = (id: string) => encodeURIComponent(id);

type WireAccount = {
  id: string;
  name: string;
  type: "CASH" | "BANK" | "POS";
  isActive: boolean;
  deactivatedAt: string | null;
  createdAt: string;
  balanceKobo: string;
};

function mapAccount(row: WireAccount): AccountRecordDto {
  return {
    ...row,
    note: null,
    updatedAt: row.createdAt,
  };
}

function queryString(values: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") query.set(key, value);
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

async function statementPage(
  accountId: string,
  options: { from?: string; to?: string; cursor?: string; limit?: number } = {},
): Promise<AccountStatementPageDto> {
  return requestJson<AccountStatementPageDto>(
    `/accounts/${idPath(accountId)}/statement${queryString({
      from: options.from,
      to: options.to,
      cursor: options.cursor,
      limit: String(options.limit ?? 50),
    })}`,
  );
}

export const accountingRealApi: AccountingApi = {
  async position(options) {
    const query = new URLSearchParams();
    if (options) {
      for (const [key, value] of Object.entries(options)) {
        if (value !== undefined && value !== null) query.set(key, String(value));
      }
    }
    const suffix = query.size ? `?${query.toString()}` : "";
    return requestJson(`/reports/financial-position${suffix}`);
  },

  async moneyFlow(from, to, accountId) {
    return requestJson(`/reports/money-flow${queryString({ from, to, accountId })}`);
  },

  async listAccounts(includeInactive = true) {
    const rows = await requestJson<WireAccount[]>(
      `/accounts?includeInactive=${includeInactive ? "true" : "false"}`,
    );
    return rows.map(mapAccount);
  },

  async listPaymentAccounts() {
    return accountingRealApi.listAccounts(false);
  },

  async createAccount(input: CreateAccountDto, idempotencyKey) {
    const row = await requestJson<WireAccount>("/accounts", {
      method: "POST",
      body: { name: input.name, type: input.type },
      idempotencyKey,
    });
    return mapAccount(row);
  },

  async updateAccount(id: string, input: UpdateAccountDto, idempotencyKey) {
    const row = await requestJson<WireAccount>(`/accounts/${idPath(id)}`, {
      method: "PATCH",
      body: { name: input.name },
      idempotencyKey,
    });
    return mapAccount(row);
  },

  async deactivateAccount(id: string, _input: DeactivateAccountDto, idempotencyKey) {
    const row = await requestJson<WireAccount>(`/accounts/${idPath(id)}/deactivate`, {
      method: "POST",
      idempotencyKey,
    });
    return mapAccount(row);
  },

  async reactivateAccount(id: string, idempotencyKey) {
    const row = await requestJson<WireAccount>(`/accounts/${idPath(id)}/reactivate`, {
      method: "POST",
      idempotencyKey,
    });
    return mapAccount(row);
  },

  async recordOpeningBalance(input: CreateOpeningBalanceDto, idempotencyKey) {
    const { accountId, amountKobo, occurredAt, note } = input;
    return requestJson<AccountLedgerEntryDto>(
      `/accounts/${idPath(accountId)}/opening-balance`,
      {
        method: "POST",
        body: {
          amountKobo,
          occurredAt,
          ...(note === null ? {} : { note }),
        },
        idempotencyKey,
      },
    );
  },

  async reconcileAccount(input: ReconcileAccountDto, idempotencyKey, countedAmountKobo) {
    if (countedAmountKobo === undefined || !/^[0-9]+$/.test(countedAmountKobo)) {
      throw new TypeError("A counted account balance is required for reconciliation.");
    }
    return requestJson<AccountLedgerEntryDto>(
      `/accounts/${idPath(input.accountId)}/reconcile`,
      {
        method: "POST",
        body: {
          countedAmountKobo,
          reason: input.note,
          occurredAt: input.occurredAt,
        },
        idempotencyKey,
      },
    );
  },

  async recordTransfer(input: CreateAccountTransferDto, idempotencyKey) {
    const transfer = await requestJson<{ id: string }>("/account-transfers", {
      method: "POST",
      body: {
        fromAccountId: input.fromAccountId,
        toAccountId: input.toAccountId,
        amountKobo: input.amountKobo,
        occurredAt: input.occurredAt,
        ...(input.note === null ? {} : { note: input.note }),
      },
      idempotencyKey,
    });
    return { id: transfer.id };
  },

  async reverseTransfer(id: string, reason: string, idempotencyKey) {
    await requestJson<unknown>(`/account-transfers/${idPath(id)}/reverse`, {
      method: "POST",
      body: { reason },
      idempotencyKey,
    });
  },

  async reverseEntry(id: string, reason: string, idempotencyKey) {
    return requestJson<AccountLedgerEntryDto>(
      `/account-entries/${idPath(id)}/reverse`,
      { method: "POST", body: { reason }, idempotencyKey },
    );
  },

  async recordManualEntry(input, idempotencyKey) {
    const { accountId, ...body } = input;
    return requestJson<AccountLedgerEntryDto>(
      `/accounts/${idPath(accountId)}/movements`,
      { method: "POST", body, idempotencyKey },
    );
  },

  async listLedgerEntries(accountId, options) {
    const entries: AccountLedgerEntryDto[] = [];
    let cursor: string | undefined;
    do {
      const page = await statementPage(accountId, {
        ...options,
        cursor,
        limit: 200,
      });
      for (const row of page.entries) {
        if (!row.occurredAt) continue;
        entries.push({
          id: row.id,
          accountId,
          type: row.type as AccountEntryType,
          amountKobo: row.amountKobo,
          salePaymentId: null,
          customerPaymentId: null,
          supplierPaymentId: null,
          purchaseId: null,
          expenseId: null,
          otherIncomeId: null,
          accountTransferId: null,
          customerRefundId: null,
          loanId: null,
          loanRepaymentId: null,
          occurredAt: row.occurredAt,
          note: row.note,
          reversesEntryId: row.reversesEntryId,
        });
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return entries;
  },

  statementPage,

  async getMigrationNotice() {
    return null;
  },

  async dismissMigrationNotice() {},
};
