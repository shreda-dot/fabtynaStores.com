"use client";

import { useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Boxes, Package, Undo2 } from "lucide-react";
import Link from "next/link";
import { formatLagosDateTime, getLagosBusinessDate } from "@fabtyna/shared";
import {
  DateRangeFilter,
  defaultListRange,
  lastDaysRange,
} from "@/components/date-range-filter";
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from "@/components/responsive-table";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { WriteFlowStatus } from "@/components/write-flow-status";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { useWriteFlow } from "@/hooks/use-write-flow";
import { emptiesApi, isMockApiMode } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import type {
  EmptiesBalanceDto,
  EmptiesKind,
  EmptiesMovementDto,
  EmptiesMovementType,
} from "@/lib/api/empties.api";
import { parseEmptiesQuantityText } from "@/lib/empties-quantity";
import { queryKeys } from "@/lib/query-keys";
import { validateReportRange } from "@/lib/report-range";
import { toast } from "@/stores/toast-store";

const PAGE_SIZE = 50;

const KIND_LABEL: Record<EmptiesKind, string> = { BOTTLE: "Bottle", CRATE: "Crate" };

const MOVEMENT_LABEL: Record<EmptiesMovementType, string> = {
  OPENING: "Opening count",
  RECEIVED: "Received from customers",
  RETURNED_TO_OWNER: "Returned to brewery",
  ADJUSTMENT: "Adjustment",
};

/** Renders a signed count with a leading sign so direction is never a colour. */
function SignedQuantity({ quantity }: { quantity: number }) {
  const sign = quantity > 0 ? "+" : quantity < 0 ? "−" : "";
  return (
    <span
      className={
        quantity < 0 ? "tabular font-medium text-danger" : "tabular font-medium text-success"
      }
    >
      {sign}
      {Math.abs(quantity)}
    </span>
  );
}

/** Inline form to record one movement against a single empties type. */
function RecordMovementPanel({
  type,
  movementType,
  onClose,
}: {
  type: EmptiesBalanceDto;
  movementType: EmptiesMovementType;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const flow = useWriteFlow();
  const network = useNetworkStatus();
  const isAdjustment = movementType === "ADJUSTMENT";
  const [quantityText, setQuantityText] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState("");
  const [lastOperation, setLastOperation] = useState<{ quantity: number; note: string } | null>(
    null,
  );

  const mutation = useMutation({
    mutationFn: async (operation: { quantity: number; note: string }) => {
      const isRetry = JSON.stringify(operation) === JSON.stringify(lastOperation);
      if (flow.status === "unknown" && !isRetry) return undefined;
      if (flow.status === "failed" && !isRetry) flow.edit();
      setLastOperation(operation);
      return flow.run((key) =>
        emptiesApi.createMovement(
          {
            typeId: type.typeId,
            movementType,
            quantity: operation.quantity,
            note: operation.note.trim() === "" ? null : operation.note.trim(),
          },
          key,
        ),
      );
    },
    onSuccess: async (result) => {
      if (!result) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.empties.all });
      toast.success(`${MOVEMENT_LABEL[movementType]} recorded.`);
      onClose();
    },
    onError: (error) => toast.error(toUserMessage(error)),
  });

  const busy = mutation.isPending || flow.status === "unknown";

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseEmptiesQuantityText(quantityText, { allowNegative: isAdjustment });
    if (!parsed.ok) {
      setFormError(parsed.message);
      return;
    }
    if (isAdjustment && note.trim() === "") {
      setFormError("A reason is required when adjusting the count.");
      return;
    }
    setFormError("");
    mutation.mutate({ quantity: parsed.quantity, note });
  }

  return (
    <Card>
      <CardHeader
        title={`${MOVEMENT_LABEL[movementType]}: ${type.label}`}
        description={`${KIND_LABEL[type.kind]} · ${type.ownerName} · ${type.quantity} on hand`}
        action={
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        }
      />
      <CardBody className="space-y-3">
        <form className="space-y-3" onSubmit={submit}>
          <FormField
            id="empties-movement-quantity"
            label={isAdjustment ? "Adjustment (use a minus sign to reduce)" : "Quantity"}
            hint={isAdjustment ? "For example 24 to add, -6 to reduce." : "Whole numbers only."}
          >
            <Input
              id="empties-movement-quantity"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={quantityText}
              placeholder={isAdjustment ? "e.g. 24 or -6" : "e.g. 24"}
              onChange={(event) => {
                flow.edit();
                setQuantityText(event.target.value);
              }}
            />
          </FormField>
          <FormField
            id="empties-movement-note"
            label={isAdjustment ? "Reason" : "Note"}
            required={isAdjustment}
          >
            <Textarea
              id="empties-movement-note"
              value={note}
              maxLength={500}
              rows={2}
              placeholder={isAdjustment ? "Why is the count changing?" : "Optional"}
              onChange={(event) => {
                flow.edit();
                setNote(event.target.value);
              }}
            />
          </FormField>
          {formError !== "" && (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={mutation.isPending} disabled={busy || network.offline}>
              Record {MOVEMENT_LABEL[movementType].toLowerCase()}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
        <WriteFlowStatus
          flow={flow}
          onRetry={() => {
            if (lastOperation) mutation.mutate(lastOperation);
          }}
          checkHref="/empties"
          checkLabel="Check empties"
          showFieldErrors
        />
      </CardBody>
    </Card>
  );
}

/** Inline form to reverse a recorded movement, with a required reason. */
function ReverseMovementPanel({
  movement,
  label,
  onClose,
}: {
  movement: EmptiesMovementDto;
  label: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const flow = useWriteFlow();
  const network = useNetworkStatus();
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState("");
  const [lastReason, setLastReason] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (reasonText: string) => {
      const isRetry = reasonText === lastReason;
      if (flow.status === "unknown" && !isRetry) return undefined;
      if (flow.status === "failed" && !isRetry) flow.edit();
      setLastReason(reasonText);
      return flow.run((key) => emptiesApi.reverseMovement(movement.id, reasonText, key));
    },
    onSuccess: async (result) => {
      if (!result) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.empties.all });
      toast.success("Movement reversed.");
      onClose();
    },
    onError: (error) => toast.error(toUserMessage(error)),
  });

  const busy = mutation.isPending || flow.status === "unknown";

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (trimmed === "") {
      setFormError("A reason is required to reverse a movement.");
      return;
    }
    setFormError("");
    mutation.mutate(trimmed);
  }

  return (
    <Card>
      <CardHeader
        title="Reverse movement"
        description={`${label} · ${MOVEMENT_LABEL[movement.movementType]} · ${movement.quantity}`}
        action={
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        }
      />
      <CardBody className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Reversing creates an opposite entry that restores the balance. The original row stays in
          history.
        </p>
        <form className="space-y-3" onSubmit={submit}>
          <FormField id="empties-reverse-reason" label="Reason" required>
            <Textarea
              id="empties-reverse-reason"
              value={reason}
              maxLength={500}
              rows={2}
              placeholder="Why is this movement being reversed?"
              onChange={(event) => {
                flow.edit();
                setReason(event.target.value);
              }}
            />
          </FormField>
          {formError !== "" && (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="danger"
              loading={mutation.isPending}
              disabled={busy || network.offline}
            >
              Reverse movement
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
        <WriteFlowStatus
          flow={flow}
          onRetry={() => {
            if (lastReason) mutation.mutate(lastReason);
          }}
          checkHref="/empties"
          checkLabel="Check empties"
          showFieldErrors
        />
      </CardBody>
    </Card>
  );
}

export default function EmptiesPage() {
  const today = useLagosBusinessDate() || getLagosBusinessDate();
  const [range, setRange] = useState(() => defaultListRange(getLagosBusinessDate()));
  const problem = validateReportRange(range.from, range.to);
  const [action, setAction] = useState<{
    type: EmptiesBalanceDto;
    movementType: EmptiesMovementType;
  } | null>(null);
  const [reverseTarget, setReverseTarget] = useState<EmptiesMovementDto | null>(null);

  const balances = useQuery({
    queryKey: queryKeys.empties.balances(false),
    queryFn: () => emptiesApi.listBalances(),
    enabled: !isMockApiMode,
  });

  const types = useQuery({
    queryKey: queryKeys.empties.types(true),
    queryFn: () => emptiesApi.listTypes({ includeInactive: true }),
    enabled: !isMockApiMode,
  });

  const movements = useInfiniteQuery({
    queryKey: queryKeys.empties.pages({ from: range.from, to: range.to }),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      emptiesApi.listMovements({
        from: range.from,
        to: range.to,
        limit: PAGE_SIZE,
        cursor: pageParam,
      }),
    getNextPageParam: (last) => last.nextCursor,
    enabled: !isMockApiMode && problem === null,
  });

  // Read before the render branches narrow `movements`.
  const loadMoreFailed = movements.isFetchNextPageError;
  const queryError: unknown = movements.error;
  const fetchNext = movements.fetchNextPage;

  const typeById = useMemo(
    () => new Map((types.data ?? []).map((type) => [type.id, type] as const)),
    [types.data],
  );

  const rows = useMemo(
    () => (movements.data?.pages ?? []).flatMap((page) => page.items),
    [movements.data],
  );

  function labelFor(typeId: string): string {
    const type = typeById.get(typeId);
    return type ? `${type.label} (${type.ownerName})` : "Unknown type";
  }

  const balanceColumns: ResponsiveTableColumn<EmptiesBalanceDto>[] = [
    { header: "Owner", render: (b) => b.ownerName },
    { header: "Type", render: (b) => `${KIND_LABEL[b.kind]} · ${b.label}` },
    {
      header: "On hand",
      align: "right",
      render: (b) => <span className="tabular font-medium">{b.quantity}</span>,
    },
    {
      header: "Unit value",
      align: "right",
      render: (b) => (b.unitValueKobo === null ? "—" : <Money kobo={b.unitValueKobo} />),
    },
    {
      header: "Value",
      align: "right",
      render: (b) => (b.valueKobo === null ? "—" : <Money kobo={b.valueKobo} tone="neutral" />),
    },
    {
      header: "Record",
      align: "right",
      render: (b) => (
        <div className="flex flex-wrap justify-end gap-1">
          {(["OPENING", "RECEIVED", "RETURNED_TO_OWNER", "ADJUSTMENT"] as const).map((type) => (
            <Button
              key={type}
              variant="secondary"
              size="sm"
              onClick={() => {
                setReverseTarget(null);
                setAction({ type: b, movementType: type });
              }}
            >
              {MOVEMENT_LABEL[type]}
            </Button>
          ))}
        </div>
      ),
    },
  ];

  const movementColumns: ResponsiveTableColumn<EmptiesMovementDto>[] = [
    { header: "When", render: (m) => formatLagosDateTime(m.occurredAt) },
    { header: "Type", render: (m) => labelFor(m.typeId) },
    { header: "Movement", render: (m) => MOVEMENT_LABEL[m.movementType] },
    {
      header: "Quantity",
      align: "right",
      render: (m) => <SignedQuantity quantity={m.quantity} />,
    },
    { header: "Note", render: (m) => m.note ?? "—" },
    {
      header: "Actions",
      align: "right",
      render: (m) =>
        m.reversesEntryId !== null ? (
          <span className="text-xs text-muted-foreground">Reversal</span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="text-danger hover:bg-danger/10"
            onClick={() => {
              setAction(null);
              setReverseTarget(m);
            }}
          >
            <Undo2 aria-hidden="true" className="h-3.5 w-3.5" />
            Reverse
          </Button>
        ),
    },
  ];

  const scope = range.from === range.to ? range.from : `${range.from} to ${range.to}`;
  const totalsByOwner = balances.data?.totalsByOwner ?? [];
  const totalsByKind = balances.data?.totalsByKind ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Empties"
        description="Count bottles and crates owed back to breweries. Counts only; values are for reference and never enter cash or profit."
        actions={
          <Link href="/empties/types" className={buttonClasses({ variant: "secondary" })}>
            <Boxes aria-hidden="true" className="h-4 w-4" />
            Manage owners &amp; types
          </Link>
        }
      />

      {isMockApiMode ? (
        <EmptyState
          title="Not available with demo data"
          description="Empties tracking needs the real server. Switch the app to real mode to use it."
        />
      ) : (
        <>
          {balances.isPending ? (
            <Skeleton variant="stat" count={4} />
          ) : balances.isError ? (
            <ErrorState
              title="Empties could not be loaded"
              message={toUserMessage(balances.error)}
              onRetry={() => void balances.refetch()}
            />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {totalsByOwner.map((total) => (
                  <StatCard
                    key={total.ownerId}
                    label={total.ownerName}
                    value={`${total.quantity} on hand`}
                    hint={<Money kobo={total.valueKobo} tone="neutral" />}
                  />
                ))}
                {totalsByKind.map((total) => (
                  <StatCard
                    key={total.kind}
                    label={`${KIND_LABEL[total.kind]}s`}
                    value={`${total.quantity}`}
                    hint={<Money kobo={total.valueKobo} tone="neutral" />}
                  />
                ))}
              </div>

              {action !== null && (
                <RecordMovementPanel
                  type={action.type}
                  movementType={action.movementType}
                  onClose={() => setAction(null)}
                />
              )}

              {(balances.data?.items.length ?? 0) === 0 ? (
                <EmptyState
                  icon={Package}
                  title="No empties types yet"
                  description="Add an owner and its bottle and crate types before recording counts."
                  action={
                    <Link
                      href="/empties/types"
                      className={buttonClasses({ variant: "secondary", size: "sm" })}
                    >
                      Manage owners &amp; types
                    </Link>
                  }
                />
              ) : (
                <Card>
                  <CardHeader
                    title="Balances by type"
                    description="On hand at the shop for each owner and type."
                  />
                  <CardBody>
                    <ResponsiveTable
                      rows={balances.data?.items ?? []}
                      columns={balanceColumns}
                      getKey={(b) => b.typeId}
                    />
                  </CardBody>
                </Card>
              )}

              {reverseTarget !== null && (
                <ReverseMovementPanel
                  movement={reverseTarget}
                  label={labelFor(reverseTarget.typeId)}
                  onClose={() => setReverseTarget(null)}
                />
              )}
            </>
          )}

          <section className="space-y-4 rounded-md border border-border bg-card p-4 sm:p-5">
            <h2 className="text-section font-semibold text-foreground">History</h2>
            <DateRangeFilter
              idPrefix="empties"
              from={range.from}
              to={range.to}
              today={today}
              onChange={setRange}
              problem={problem}
            />

            {problem !== null ? null : movements.isPending ? (
              <Skeleton variant="row" count={6} />
            ) : movements.isError && !loadMoreFailed ? (
              <ErrorState
                title="Empties history could not be loaded"
                message={toUserMessage(queryError)}
                onRetry={() => void movements.refetch()}
              />
            ) : rows.length === 0 ? (
              <EmptyState
                icon={Boxes}
                title={`No empties movements for ${scope}`}
                description="Choose another period, or record a count from the balances above."
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setRange(lastDaysRange(today, 365))}
                  >
                    Show the last 12 months
                  </Button>
                }
              />
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Showing {rows.length} movements for {scope}
                  {movements.hasNextPage ? " (more available)" : ""}.
                </p>
                <ResponsiveTable rows={rows} columns={movementColumns} getKey={(m) => m.id} />
                {loadMoreFailed && (
                  <ErrorState
                    title="More movements could not be loaded"
                    message={toUserMessage(queryError)}
                    onRetry={() => void fetchNext()}
                  />
                )}
                {movements.hasNextPage && (
                  <div className="flex justify-center">
                    <Button
                      variant="secondary"
                      loading={movements.isFetchingNextPage}
                      onClick={() => void movements.fetchNextPage()}
                    >
                      Load more
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
