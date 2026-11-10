"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import type { DrawingItem, DrawingList, DrawingTotal } from "@/lib/api/family-support.api";

const PAGE_SIZE = 25;
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos",
});

export const historyDate = (date: Date | string) => dateFormatter.format(new Date(date));
const label = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());

function sorted<T extends DrawingTotal>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const left = BigInt(a.amountKobo);
    const right = BigInt(b.amountKobo);
    return left === right ? a.name.localeCompare(b.name) || a.id.localeCompare(b.id) : left > right ? -1 : 1;
  });
}

function DrawingDetails({ row }: { row: DrawingItem }) {
  if (row.sourceExpenseId !== null) {
    const prefix = "Reclassified expense: ";
    const description = row.note?.startsWith(prefix) ? row.note.slice(prefix.length).trim() : "";
    return (
      <div className="mt-1 space-y-1 text-xs text-muted-foreground">
        <p>{description || "Original expense description unavailable."}</p>
        <p>posted {historyDate(row.postedAt)}</p>
      </div>
    );
  }
  if (!row.note?.trim() || row.note.startsWith("Owner drawing:")) return null;
  return <p className="mt-1 text-xs text-muted-foreground">{row.note}</p>;
}

function DrawingAction({ row, pending, onReverse }: {
  row: DrawingItem; pending: boolean; onReverse: (id: string) => void;
}) {
  if (row.sourceExpenseId !== null) {
    return null;
  }
  if (row.reversed) return null;
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => onReverse(row.id)}>Reverse</Button>;
}

function DrawingStatus({ row }: { row: DrawingItem }) {
  return (
    <div className="space-y-1">
      {row.reversed && <Badge>Reversed</Badge>}
      {row.sourceExpenseId !== null && <Badge className="whitespace-normal">Reclassified from expense</Badge>}
      {!row.reversed && row.sourceExpenseId === null && <span>Active</span>}
    </div>
  );
}

function TotalCard({ title, rows, formatName = (name) => name }: {
  title: string; rows: readonly (DrawingTotal & { byPurpose?: DrawingTotal[] })[]; formatName?: (name: string) => string;
}) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        <dl className="space-y-2 text-sm">
          {sorted(rows).map((row) => (
            <div key={row.id}>
              <div className="flex justify-between gap-3">
                <dt>{formatName(row.name)}</dt>
                <dd className="text-right font-medium"><Money kobo={row.amountKobo} /></dd>
              </div>
              {row.byPurpose && sorted(row.byPurpose).map((purpose) => (
                <div key={purpose.id} className="ml-3 flex justify-between gap-3 text-muted-foreground">
                  <dt>{label(purpose.name)}</dt><dd className="text-right"><Money kobo={purpose.amountKobo} /></dd>
                </div>
              ))}
            </div>
          ))}
        </dl>
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No drawings.</p>}
      </CardBody>
    </Card>
  );
}

export function DrawingHistory({ data, pending, onReverse }: {
  data: DrawingList; pending: boolean; onReverse: (id: string) => void;
}) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const items = data.items.slice(0, visible);
  return (
    <>
      <p className="flex flex-wrap items-baseline justify-between gap-2 font-semibold">
        <span>Total <span className="text-sm font-normal text-muted-foreground">({data.report.count} drawings)</span></span>
        <Money kobo={data.report.totalKobo} />
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        <TotalCard title="By beneficiary" rows={data.report.byBeneficiary} />
        <TotalCard title="By purpose" rows={data.report.byPurpose} formatName={label} />
        <TotalCard title="By account" rows={data.report.byAccount} />
      </div>
      {items.length === 0 && <p>No drawings in this range.</p>}
      {items.length > 0 && <>
        {items.some((row) => row.sourceExpenseId !== null) && (
          <p className="text-xs text-muted-foreground">Reclassified drawings cannot be reversed here.</p>
        )}
        <div className="hidden max-h-[32rem] overflow-auto md:block">
          <table className="w-full min-w-[850px] table-fixed text-sm">
            <colgroup>
              <col className="w-[110px]" /><col /><col /><col /><col className="w-[130px]" />
              <col className="w-[110px]" /><col className="w-[90px]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-card"><tr className="border-b border-border text-left text-xs font-medium text-muted-foreground">
              <th className="p-3 font-medium">Date</th><th className="p-3 font-medium">Beneficiary</th><th className="p-3 font-medium">Purpose</th>
              <th className="p-3 font-medium">Account</th><th className="p-3 text-right font-medium">Amount</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium"><span className="sr-only">Action</span></th>
            </tr></thead>
            <tbody>{items.map((row) => (
              <tr key={row.id} className={`border-b border-border/60 align-top hover:bg-muted/50 ${row.reversed ? "text-muted-foreground" : ""}`}>
                <td className="p-3 whitespace-nowrap">{historyDate(row.occurredAt)}</td>
                <td className="p-3"><span className="block truncate" title={row.beneficiaryName}>{row.beneficiaryName}</span><DrawingDetails row={row} /></td>
                <td className="p-3"><span className="block truncate" title={label(row.purpose)}>{label(row.purpose)}</span></td>
                <td className="p-3"><span className="block truncate" title={row.accountName}>{row.accountName}</span></td>
                <td className="p-3 text-right"><Money kobo={row.amountKobo} tone="neutral" /></td>
                <td className="p-3"><DrawingStatus row={row} /></td>
                <td className="p-1"><DrawingAction row={row} pending={pending} onReverse={onReverse} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <ul className="space-y-3 md:hidden">
          {items.map((row) => (
            <li key={row.id} className={`rounded-md border border-border p-3 text-sm ${row.reversed ? "text-muted-foreground" : ""}`}>
              <div className="flex justify-between gap-3 font-medium"><span>{historyDate(row.occurredAt)}</span><Money kobo={row.amountKobo} tone="neutral" /></div>
              <dl className="mt-2 space-y-1">
                <div><dt className="inline text-muted-foreground">Beneficiary: </dt><dd className="inline">{row.beneficiaryName}</dd></div>
                <div><dt className="inline text-muted-foreground">Purpose: </dt><dd className="inline">{label(row.purpose)}</dd></div>
                <div><dt className="inline text-muted-foreground">Account: </dt><dd className="inline">{row.accountName}</dd></div>
              </dl>
              <div className="mt-2"><DrawingStatus row={row} /></div>
              <DrawingDetails row={row} />
              <div className="mt-2"><DrawingAction row={row} pending={pending} onReverse={onReverse} /></div>
            </li>
          ))}
        </ul>
        {visible < data.items.length && (
          <Button variant="secondary" onClick={() => setVisible((count) => count + PAGE_SIZE)}>
            Show more ({data.items.length - items.length} remaining)
          </Button>
        )}
      </>}
    </>
  );
}
