import type { LoanLedgerEntryDto, LoanStatus } from "@fabtyna/shared";
import { requestJson } from "./client";
import type {
  LoanDetailDto,
  LoanDetailWithSavedRepayment,
  LoanListItemDto,
  LoanListOptions,
  LoanListPageDto,
  LoansApi,
  SavedRepaymentDto,
} from "./loans.api";

type ApiLoanListItem = {
  id: string;
  lenderName: string;
  principalKobo: string;
  chargesKobo: string;
  totalToRepayKobo: string;
  repaidKobo: string;
  outstandingKobo: string;
  dueDate: string | null;
  disbursedAt: string;
  status: LoanStatus;
};

type ApiLoanDetail = {
  summary: {
    id: string;
    lenderName: string;
    principalKobo: string;
    agreedInterestKobo: string;
    disbursedAt: string;
    dueDate: string | null;
    note: string | null;
    status: LoanStatus;
    chargesKobo: string;
    totalToRepayKobo: string;
    repaidKobo: string;
    outstandingKobo: string;
  };
  ledgerEntries: Array<Omit<LoanLedgerEntryDto, "loanId"> & { isReversal?: boolean; reversed?: boolean }>;
  repayments: Array<{
    id: string;
    amountKobo: string;
    interestPortionKobo: string;
    paidAt: string;
    note: string | null;
    accountId: string | null;
    accountName: string | null;
    reversed: boolean;
  }>;
};

function query(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") params.set(name, value);
  }
  const result = params.toString();
  return result ? `?${result}` : "";
}

function mapListItem(item: ApiLoanListItem): LoanListItemDto {
  return {
    id: item.id,
    lenderName: item.lenderName,
    principalKobo: item.principalKobo,
    disbursedAt: item.disbursedAt,
    dueDate: item.dueDate,
    outstandingKobo: item.outstandingKobo,
    totalRepayableKobo: item.totalToRepayKobo,
    repaidKobo: item.repaidKobo,
    status: item.status,
  };
}

function mapDetail(data: ApiLoanDetail): LoanDetailDto {
  const s = data.summary;
  return {
    id: s.id,
    lenderName: s.lenderName,
    principalKobo: s.principalKobo,
    agreedInterestKobo: s.agreedInterestKobo,
    disbursedAt: s.disbursedAt,
    dueDate: s.dueDate,
    note: s.note,
    // The API does not return createdAt; disbursedAt is the closest honest value.
    createdAt: s.disbursedAt,
    outstandingKobo: s.outstandingKobo,
    status: s.status,
    chargesKobo: s.chargesKobo,
    totalRepayableKobo: s.totalToRepayKobo,
    repaidKobo: s.repaidKobo,
    ledger: data.ledgerEntries.map((entry) => ({
      id: entry.id,
      loanId: s.id,
      type: entry.type,
      amountKobo: entry.amountKobo,
      loanRepaymentId: entry.loanRepaymentId,
      reversesEntryId: entry.reversesEntryId,
      note: entry.note,
      occurredAt: entry.occurredAt,
    })),
    repayments: data.repayments.map((r) => ({
      id: r.id,
      loanId: s.id,
      amountKobo: r.amountKobo,
      interestPortionKobo: r.interestPortionKobo,
      note: r.note,
      paidAt: r.paidAt,
      createdAt: r.paidAt,
      accountId: r.accountId,
      accountName: r.accountName,
      reversed: r.reversed,
    })),
  };
}

async function getById(id: string): Promise<LoanDetailDto> {
  return mapDetail(await requestJson<ApiLoanDetail>(`/loans/${encodeURIComponent(id)}`));
}

async function listPage(
  options: LoanListOptions & { cursor?: string; limit?: number } = {},
): Promise<LoanListPageDto> {
  const page = await requestJson<{ items: ApiLoanListItem[]; nextCursor: string | null }>(
    `/loans${query({
      status: options.status,
      q: options.search?.trim(),
      dueBefore: options.dueBefore,
      cursor: options.cursor,
      limit: String(options.limit ?? 50),
    })}`,
  );
  return { items: page.items.map(mapListItem), nextCursor: page.nextCursor };
}

export const loansRealApi: LoansApi = {
  listPage,

  async list(options = {}) {
    const items: LoanListItemDto[] = [];
    let cursor: string | undefined;
    do {
      const page = await listPage({ ...options, cursor, limit: 200 });
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return items;
  },

  getById,

  async create(input, idempotencyKey) {
    const created = await requestJson<{ id: string }>("/loans", {
      method: "POST",
      body: input,
      idempotencyKey,
    });
    return getById(created.id);
  },

  async addCharge(id, input, idempotencyKey) {
    await requestJson(`/loans/${encodeURIComponent(id)}/charges`, {
      method: "POST",
      body: input,
      idempotencyKey,
    });
    return getById(id);
  },

  async recordRepayment(id, input, idempotencyKey): Promise<LoanDetailWithSavedRepayment> {
    const saved = await requestJson<SavedRepaymentDto>(
      `/loans/${encodeURIComponent(id)}/repayments`,
      { method: "POST", body: input, idempotencyKey },
    );
    const detail = await getById(id);
    return {
      ...detail,
      savedRepayment: {
        id: saved.id,
        amountKobo: saved.amountKobo,
        interestPortionKobo: saved.interestPortionKobo,
        paidAt: saved.paidAt,
        accountId: saved.accountId,
      },
    };
  },
};
