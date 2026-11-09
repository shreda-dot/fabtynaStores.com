import { getLagosBusinessDate, getLagosBusinessDayRange } from "../lagos-time.ts";
import type { DrawingPurpose } from "../schemas/family-support.ts";

export interface DrawingReportEntry {
  id: string;
  beneficiaryId: string;
  beneficiaryName: string;
  purpose: DrawingPurpose;
  accountId: string;
  accountName: string;
  amountKobo: bigint;
  occurredAt: Date;
  reversed: boolean;
}

export interface DrawingReportFilter {
  from: string;
  to: string;
  beneficiaryId?: string;
  purpose?: DrawingPurpose;
  accountId?: string;
}

export interface DrawingReportTotal {
  id: string;
  name: string;
  amountKobo: bigint;
  count: number;
}

export interface DrawingReport {
  count: number;
  totalKobo: bigint;
  byBeneficiary: (DrawingReportTotal & { byPurpose: DrawingReportTotal[] })[];
  byPurpose: DrawingReportTotal[];
  byAccount: DrawingReportTotal[];
}

function addTotal(
  totals: Map<string, DrawingReportTotal>,
  id: string,
  name: string,
  amountKobo: bigint,
): void {
  const total = totals.get(id);
  if (total) {
    if (total.name !== name) throw new RangeError(`Inconsistent name for '${id}'.`);
    total.amountKobo += amountKobo;
    total.count += 1;
  } else {
    totals.set(id, { id, name, amountKobo, count: 1 });
  }
}

function sortedTotals(totals: Map<string, DrawingReportTotal>): DrawingReportTotal[] {
  return [...totals.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}

/** Totals active drawing documents by their original Lagos business date. */
export function drawingReport(
  entries: readonly DrawingReportEntry[],
  filter: DrawingReportFilter,
): DrawingReport {
  getLagosBusinessDayRange(filter.from);
  getLagosBusinessDayRange(filter.to);
  if (filter.from > filter.to) throw new RangeError("From date must be on or before to date.");

  const beneficiaries = new Map<string, DrawingReportTotal>();
  const purposes = new Map<string, DrawingReportTotal>();
  const accounts = new Map<string, DrawingReportTotal>();
  const purposesByBeneficiary = new Map<string, Map<string, DrawingReportTotal>>();
  const ids = new Set<string>();
  let totalKobo = 0n;
  let count = 0;

  for (const entry of entries) {
    if (ids.has(entry.id)) throw new RangeError(`Duplicate drawing '${entry.id}'.`);
    ids.add(entry.id);
    if (entry.amountKobo <= 0n) throw new RangeError("Drawing amount must be positive.");
    if (!Number.isFinite(entry.occurredAt.getTime())) throw new RangeError("Drawing date must be valid.");
    const date = getLagosBusinessDate(entry.occurredAt);
    if (
      entry.reversed ||
      date < filter.from ||
      date > filter.to ||
      (filter.beneficiaryId !== undefined && entry.beneficiaryId !== filter.beneficiaryId) ||
      (filter.purpose !== undefined && entry.purpose !== filter.purpose) ||
      (filter.accountId !== undefined && entry.accountId !== filter.accountId)
    ) continue;

    count += 1;
    totalKobo += entry.amountKobo;
    addTotal(beneficiaries, entry.beneficiaryId, entry.beneficiaryName, entry.amountKobo);
    addTotal(purposes, entry.purpose, entry.purpose, entry.amountKobo);
    addTotal(accounts, entry.accountId, entry.accountName, entry.amountKobo);
    let breakdown = purposesByBeneficiary.get(entry.beneficiaryId);
    if (!breakdown) {
      breakdown = new Map();
      purposesByBeneficiary.set(entry.beneficiaryId, breakdown);
    }
    addTotal(breakdown, entry.purpose, entry.purpose, entry.amountKobo);
  }

  return {
    count,
    totalKobo,
    byBeneficiary: sortedTotals(beneficiaries).map((beneficiary) => ({
      ...beneficiary,
      byPurpose: sortedTotals(purposesByBeneficiary.get(beneficiary.id)!),
    })),
    byPurpose: sortedTotals(purposes),
    byAccount: sortedTotals(accounts),
  };
}
