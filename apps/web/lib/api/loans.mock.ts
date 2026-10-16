import {
  addLoanChargeDtoSchema,
  addLoanCharge,
  createLoan,
  createLoanDtoSchema,
  fromAuditLogDto,
  getLagosBusinessDate,
  loanOutstandingKobo,
  loanStatus,
  recordLoanRepayment,
  recordLoanRepaymentDtoSchema,
  toAuditLogDto,
  toLoanDto,
  toLoanLedgerEntryDto,
  toLoanRepaymentDto,
  type Loan,
} from "@fabtyna/shared";
import type {
  LoanDetailDto,
  LoanListItemDto,
  LoansApi,
} from "./loans.api";
import { newId, readMockStore, transactMockStore } from "./mock-store";
import { mockDelay } from "./mock-transport";

function delay(): Promise<void> {
  return mockDelay();
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function audit(
  draft: ReturnType<typeof readMockStore>,
  action: string,
  entityId: string,
  beforeData: unknown,
  afterData: unknown,
): void {
  draft.auditLogs.push(
    fromAuditLogDto(
      toAuditLogDto({
        id: newId(),
        actorId: null,
        action,
        entityType: "Loan",
        entityId,
        beforeData,
        afterData,
        metadata: null,
        occurredAt: new Date(),
      }),
    ),
  );
}

function totalRepayableKobo(loanId: string, entries: { loanId: string; amountKobo: bigint }[]): bigint {
  let total = 0n;
  for (const entry of entries) {
    if (entry.loanId === loanId && entry.amountKobo > 0n) total += entry.amountKobo;
  }
  return total;
}

function buildLoanDetail(
  store: ReturnType<typeof readMockStore>,
  loan: Loan,
): LoanDetailDto {
  const today = getLagosBusinessDate();
  const ledger = store.loanLedgerEntries
    .filter((entry) => entry.loanId === loan.id)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const repayments = store.loanRepayments
    .filter((repayment) => repayment.loanId === loan.id)
    .sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());
  return jsonClone({
    ...toLoanDto(loan),
    outstandingKobo: loanOutstandingKobo(loan.id, store.loanLedgerEntries).toString(),
    status: loanStatus(loan, store.loanLedgerEntries, today),
    ledger: ledger.map(toLoanLedgerEntryDto),
    repayments: repayments.map(toLoanRepaymentDto),
  });
}

export const loansMockApi: LoansApi = {
  async list() {
    await delay();
    const store = readMockStore();
    const today = getLagosBusinessDate();
    const items: LoanListItemDto[] = store.loans
      .slice()
      .map((loan) => {
        const entries = store.loanLedgerEntries.filter(
          (entry) => entry.loanId === loan.id,
        );
        const outstanding = loanOutstandingKobo(loan.id, store.loanLedgerEntries);
        const totalRepayable = totalRepayableKobo(loan.id, entries);
        return {
          ...toLoanDto(loan),
          outstandingKobo: outstanding.toString(),
          totalRepayableKobo: totalRepayable.toString(),
          repaidKobo: (totalRepayable - outstanding).toString(),
          status: loanStatus(loan, store.loanLedgerEntries, today),
        };
      })
      .sort((a, b) => {
        // Soonest due date first; loans without a due date sink to the bottom.
        if (a.dueDate === null && b.dueDate === null) {
          return new Date(a.disbursedAt).getTime() - new Date(b.disbursedAt).getTime();
        }
        if (a.dueDate === null) return 1;
        if (b.dueDate === null) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      });
    return jsonClone(items);
  },

  async getById(id) {
    await delay();
    const store = readMockStore();
    const loan = store.loans.find((candidate) => candidate.id === id);
    if (!loan) throw new Error("Loan not found.");
    return buildLoanDetail(store, loan);
  },

  async create(input) {
    await delay();
    const data = createLoanDtoSchema.parse(input);
    const result = transactMockStore((draft) => {
      const created = createLoan(
        {
          lenderName: data.lenderName,
          principalKobo: BigInt(data.principalKobo),
          agreedInterestKobo: BigInt(data.agreedInterestKobo),
          disbursedAt: new Date(data.disbursedAt),
          dueDate: data.dueDate,
          note: data.note,
        },
        newId,
      );
      draft.loans.push(created.loan);
      draft.loanLedgerEntries.push(...created.ledgerEntries);
      audit(draft, "LOAN_CREATED", created.loan.id, null, toLoanDto(created.loan));
      return created.loan;
    });

    const store = readMockStore();
    const loan = store.loans.find((candidate) => candidate.id === result.id)!;
    return buildLoanDetail(store, loan);
  },

  async addCharge(id, input) {
    await delay();
    const data = addLoanChargeDtoSchema.parse(input);
    transactMockStore((draft) => {
      const charge = addLoanCharge(
        {
          loanId: id,
          amountKobo: BigInt(data.amountKobo),
          reason: data.reason,
          occurredAt: new Date(data.occurredAt),
        },
        draft.loans,
        newId,
      );
      draft.loanLedgerEntries.push(charge);
      audit(draft, "LOAN_CHARGE_ADDED", id, null, toLoanLedgerEntryDto(charge));
      return charge;
    });

    const store = readMockStore();
    const loan = store.loans.find((candidate) => candidate.id === id);
    if (!loan) throw new Error("Loan not found.");
    return buildLoanDetail(store, loan);
  },

  async recordRepayment(id, input) {
    await delay();
    const data = recordLoanRepaymentDtoSchema.parse(input);
    transactMockStore((draft) => {
      const recorded = recordLoanRepayment(
        {
          loanId: id,
          amountKobo: BigInt(data.amountKobo),
          interestPortionKobo: BigInt(data.interestPortionKobo),
          paidAt: new Date(data.paidAt),
          note: data.note ?? null,
        },
        draft.loans,
        draft.loanLedgerEntries,
        newId,
      );
      draft.loanRepayments.push(recorded.repayment);
      draft.loanLedgerEntries.push(recorded.ledgerEntry);
      if (recorded.expense) {
        // The interest portion reduces net profit through a linked expense;
        // the repayment carries the expense id so the two can never diverge.
        draft.expenses.push(recorded.expense);
      }
      audit(
        draft,
        "LOAN_REPAYMENT_RECORDED",
        id,
        null,
        toLoanRepaymentDto(recorded.repayment),
      );
      return recorded.repayment;
    });

    const store = readMockStore();
    const loan = store.loans.find((candidate) => candidate.id === id);
    if (!loan) throw new Error("Loan not found.");
    return buildLoanDetail(store, loan);
  },
};
