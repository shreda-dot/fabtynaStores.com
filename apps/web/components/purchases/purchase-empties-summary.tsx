import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { PurchaseEmptiesDetailDto } from "@/lib/api/purchases.api";

const EVENT_LABELS: Record<string, string> = {
  RETURNED_FOR_PURCHASE: "Returned",
  SUPPLIED_FREE: "Supplied free by supplier",
  PURCHASE_DEBT: "Owed to supplier",
  DEBT_SETTLEMENT: "Returned against debt",
};

export function PurchaseEmptiesSummary({
  empties,
  supplier,
}: {
  empties: PurchaseEmptiesDetailDto;
  supplier: { id: string } | null;
}) {
  if (!empties.tracked) return null;

  return (
    <Card>
      <CardHeader
        title="Purchase empties"
        description="Containers and supplier empties debt are tracked separately from money payables."
      />
      <CardBody className="space-y-4">
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Required containers</h3>
          {empties.requirements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No containers were required for this purchase.</p>
          ) : empties.requirements.map((requirement) => (
            <div key={JSON.stringify([requirement.purchaseLineId, requirement.kind])} className="flex flex-wrap justify-between gap-2 text-sm">
              <span>{requirement.label} · {requirement.kind.toLowerCase()}</span>
              <span className="tabular">{requirement.quantity} required</span>
            </div>
          ))}
        </div>
        <div className="space-y-2 border-t border-border pt-3">
          <h3 className="text-sm font-medium">Recorded on this purchase</h3>
          {empties.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No supplier container events were recorded.</p>
          ) : empties.events.map((event) => (
            <div key={event.id} className="flex flex-wrap justify-between gap-2 text-sm">
              <span>
                {EVENT_LABELS[event.eventType] ?? event.eventType.replace(/_/g, " ").toLowerCase()}
                {" · "}{event.label} {event.kind.toLowerCase()}
                {event.reversed ? " · corrected" : ""}
              </span>
              <span className="tabular">{Math.abs(event.quantity)}</span>
            </div>
          ))}
        </div>
        {empties.debts.length > 0 && (
          <div className="space-y-2 border-t border-border pt-3">
            <h3 className="text-sm font-medium">Supplier empties still owed</h3>
            {empties.debts.map((debt) => (
              <div key={debt.id} className="flex flex-wrap justify-between gap-2 text-sm">
                <span>{debt.label} · {debt.kind.toLowerCase()}</span>
                <span className="tabular">{debt.quantity} remaining</span>
              </div>
            ))}
            {supplier && (
              <Link href={`/suppliers/${supplier.id}/empties`} className="text-sm font-medium text-primary hover:underline">
                View supplier empties debt and record a return
              </Link>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
