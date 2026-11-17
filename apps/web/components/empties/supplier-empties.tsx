"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { WriteFlowStatus } from "@/components/write-flow-status";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { useWriteFlow } from "@/hooks/use-write-flow";
import { emptiesApi, isMockApiMode, suppliersApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import type { EmptiesTypeDto } from "@/lib/api/empties.api";
import { formatEmptiesCount } from "@/lib/empties-overview";
import { queryKeys } from "@/lib/query-keys";

type Props = {
  supplierId?: string;
  supplierName?: string;
};

function containerLabel(kind: "CRATE" | "BOTTLE", quantity: number) {
  const unit = kind === "CRATE" ? "crate" : "bottle";
  return `${formatEmptiesCount(quantity)} empty ${unit}${quantity === 1 ? "" : "s"}`;
}

export function SupplierEmpties({ supplierId, supplierName }: Props) {
  const queryClient = useQueryClient();
  const network = useNetworkStatus();
  const [selectedSupplierId, setSelectedSupplierId] = useState(supplierId ?? "");
  const [openingTypeId, setOpeningTypeId] = useState("");
  const [openingQuantity, setOpeningQuantity] = useState("");
  const [openingNote, setOpeningNote] = useState("");
  const [openingError, setOpeningError] = useState("");
  const [returnQuantity, setReturnQuantity] = useState<Record<string, string>>({});
  const [settlementNote, setSettlementNote] = useState<Record<string, string>>({});
  const openingFlow = useWriteFlow();
  const settlementFlow = useWriteFlow();
  const reverseFlow = useWriteFlow();
  const [correctionTarget, setCorrectionTarget] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionError, setCorrectionError] = useState("");
  const [lastOpening, setLastOpening] = useState<{ supplierId: string; typeId: string; quantity: number; note: string } | null>(null);
  const [lastSettlement, setLastSettlement] = useState<{ supplierId: string; typeId: string; quantity: number; note?: string } | null>(null);
  const [lastCorrection, setLastCorrection] = useState<{ id: string; reason: string } | null>(null);
  const demo = isMockApiMode;
  const supplierFilter = supplierId ?? (selectedSupplierId || undefined);

  const suppliers = useQuery({
    queryKey: queryKeys.suppliers.list("", false),
    queryFn: () => suppliersApi.list({ search: "", includeDeleted: false }),
    enabled: !demo && supplierId === undefined,
  });
  const debts = useInfiniteQuery({
    queryKey: queryKeys.empties.supplierDebts({ supplierId: supplierFilter }),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => emptiesApi.listSupplierDebts({
      supplierId: supplierFilter,
      cursor: pageParam,
      limit: 200,
      includeSettled: true,
    }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: !demo,
  });
  const settlements = useInfiniteQuery({
    queryKey: queryKeys.empties.supplierSettlements({ supplierId: supplierFilter }),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => emptiesApi.listSupplierSettlements({
      supplierId: supplierFilter,
      cursor: pageParam,
      limit: 100,
    }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: !demo,
  });
  const types = useQuery({
    queryKey: queryKeys.empties.types(false),
    queryFn: () => emptiesApi.listTypes(),
    enabled: !demo,
  });
  const balances = useQuery({
    queryKey: queryKeys.empties.balances(false),
    queryFn: () => emptiesApi.listBalances(),
    enabled: !demo,
  });

  const settlementRows = settlements.data?.pages.flatMap((page) => page.items) ?? [];
  const activeTypes = types.data ?? [];
  const balanceByType = new Map((balances.data?.items ?? []).map((balance) => [balance.typeId, balance.quantity]));
  const groupedDebts = useMemo(() => {
    const debtRows = debts.data?.pages.flatMap((page) => page.items) ?? [];
    const groups = new Map<string, {
      supplierId: string;
      supplierName: string;
      ownerName: string;
      typeId: string;
      kind: "CRATE" | "BOTTLE";
      label: string;
      quantity: number;
      purchases: Array<{ id: string; reference: string | null; quantity: number }>;
    }>();
    for (const row of debtRows) {
      const key = `${row.supplierId}:${row.typeId}`;
      const group = groups.get(key) ?? {
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        ownerName: row.ownerName,
        typeId: row.typeId,
        kind: row.kind,
        label: row.typeLabel,
        quantity: 0,
        purchases: [],
      };
      group.quantity += row.quantity;
      if (row.purchaseId !== null) {
        group.purchases.push({
          id: row.purchaseId,
          reference: row.purchaseReference,
          quantity: row.quantity,
        });
      }
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [debts.data]);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.empties.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.purchases.all }),
    ]);
  }

  const openingMutation = useMutation({
    mutationFn: (input: { supplierId: string; typeId: string; quantity: number; note: string }) => {
      const isRetry = JSON.stringify(input) === JSON.stringify(lastOpening);
      if (openingFlow.status === "unknown" && !isRetry) return Promise.resolve(undefined);
      if (openingFlow.status === "failed" && !isRetry) openingFlow.edit();
      setLastOpening(input);
      return openingFlow.run(
        "empties.supplierDebt.opening",
        (key) => emptiesApi.createOpeningSupplierDebt(input, key),
        {},
      );
    },
    onSuccess: async (result) => {
      if (result === undefined) return;
      setOpeningQuantity("");
      setOpeningNote("");
      setOpeningError("");
      await refresh();
    },
    onError: (cause) => setOpeningError(toUserMessage(cause)),
  });

  const settlementMutation = useMutation({
    mutationFn: (input: { supplierId: string; typeId: string; quantity: number; note?: string }) => {
      const isRetry = JSON.stringify(input) === JSON.stringify(lastSettlement);
      if (settlementFlow.status === "unknown" && !isRetry) return Promise.resolve(undefined);
      if (settlementFlow.status === "failed" && !isRetry) settlementFlow.edit();
      setLastSettlement(input);
      return settlementFlow.run(
        "empties.supplierDebt.settle",
        (key) => emptiesApi.settleSupplierDebt(input, key),
        {},
      );
    },
    onSuccess: async (result) => {
      if (result === undefined) return;
      await refresh();
    },
  });
  const correctionMutation = useMutation({
    mutationFn: (input: { id: string; reason: string }) => {
      const isRetry = JSON.stringify(input) === JSON.stringify(lastCorrection);
      if (reverseFlow.status === "unknown" && !isRetry) return Promise.resolve(undefined);
      if (reverseFlow.status === "failed" && !isRetry) reverseFlow.edit();
      setLastCorrection(input);
      return reverseFlow.run(
        "empties.supplierDebt.reverse",
        (key) => emptiesApi.reverseSupplierSettlement(input.id, input.reason, key),
        {},
      );
    },
    onSuccess: async (result) => {
      if (result === undefined) return;
      setCorrectionTarget("");
      setCorrectionReason("");
      setCorrectionError("");
      await refresh();
    },
  });

  if (demo) {
    return (
      <Card>
        <CardHeader title="Supplier empties debts" />
        <CardBody>
          <p role="status" className="rounded-md border border-warning/40 bg-warning-surface p-3 text-sm text-warning">
            Supplier empties debt history and returns are not tracked in demo mode.
          </p>
        </CardBody>
      </Card>
    );
  }

  const dataFailed = debts.isError || types.isError || balances.isError || settlements.isError || (supplierId === undefined && suppliers.isError);
  if (dataFailed) {
    const cause = debts.error ?? types.error ?? balances.error ?? settlements.error ?? suppliers.error;
    return <ErrorState title="Supplier empties could not be loaded" message={toUserMessage(cause)} onRetry={() => {
      void debts.refetch();
      void types.refetch();
      void balances.refetch();
      void settlements.refetch();
      if (supplierId === undefined) void suppliers.refetch();
    }} />;
  }

  const resolvedSupplierId = supplierId ?? selectedSupplierId;
  const openingTypes: EmptiesTypeDto[] = activeTypes;

  return (
    <div id="supplier-empties" className="space-y-4">
      {supplierId === undefined && (
        <Card>
          <CardHeader title="Supplier empties" description="This ledger is separate from money payables." />
          <CardBody className="space-y-4">
            <FormField id="empties-supplier-filter" label="Supplier">
              <Select id="empties-supplier-filter" value={selectedSupplierId} onChange={(event) => setSelectedSupplierId(event.target.value)}>
                <option value="">All suppliers</option>
                {(suppliers.data ?? []).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
              </Select>
            </FormField>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Outstanding empties owed" description="Returns are allocated to the oldest linked purchases first. This does not change money payables." />
        <CardBody className="space-y-3">
          {debts.isPending ? <Skeleton variant="row" count={3} /> : groupedDebts.every((group) => group.quantity === 0) ? (
            <EmptyState title="No empties debts" description="There are no outstanding supplier empties for this view." />
          ) : groupedDebts
            .filter((group) => group.quantity > 0)
            .filter((group) => supplierId === undefined ? selectedSupplierId === "" || group.supplierId === selectedSupplierId : true)
            .map((group) => {
              const key = `${group.supplierId}:${group.typeId}`;
              const available = balanceByType.get(group.typeId) ?? 0;
              const typed = returnQuantity[key] ?? "";
              const quantity = /^[1-9]\d*$/.test(typed) ? Number(typed) : 0;
              const overLimit = quantity > group.quantity || quantity > available;
              return (
                <div key={key} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{group.supplierName} · {group.ownerName} · {group.label}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Owed: {containerLabel(group.kind, group.quantity)} · On hand: {containerLabel(group.kind, available)}
                      </p>
                      {group.purchases.length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Linked purchases: {group.purchases.map((purchase) => purchase.reference ?? purchase.id.slice(0, 8)).join(", ")}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
                    <FormField id={`return-quantity-${key}`} label="Empties returned">
                      <Input
                        id={`return-quantity-${key}`}
                        type="number"
                        min="1"
                        max={Math.min(group.quantity, available)}
                        step="1"
                        value={typed}
                        onChange={(event) => setReturnQuantity((current) => ({ ...current, [key]: event.target.value }))}
                      />
                    </FormField>
                    <FormField id={`return-note-${key}`} label="Note (optional)">
                      <Input
                        id={`return-note-${key}`}
                        value={settlementNote[key] ?? ""}
                        onChange={(event) => setSettlementNote((current) => ({ ...current, [key]: event.target.value }))}
                        placeholder="e.g. Returned with today's delivery"
                      />
                    </FormField>
                    <Button
                      type="button"
                      variant="secondary"
                      loading={settlementMutation.isPending && lastSettlement?.supplierId === group.supplierId && lastSettlement.typeId === group.typeId}
                      disabled={network.offline || settlementMutation.isPending || settlementFlow.status === "unknown" || quantity < 1 || overLimit}
                      onClick={() => settlementMutation.mutate({
                        supplierId: group.supplierId,
                        typeId: group.typeId,
                        quantity,
                        ...(settlementNote[key]?.trim() ? { note: settlementNote[key].trim() } : {}),
                      })}
                    >
                      Record return
                    </Button>
                  </div>
                  {overLimit && <p role="alert" className="mt-2 text-sm text-danger">The return cannot be more than the debt or the empties available.</p>}
                </div>
              );
            })}
          {debts.hasNextPage && <Button type="button" variant="secondary" onClick={() => void debts.fetchNextPage()} disabled={debts.isFetchingNextPage}>Load more debts</Button>}
          <WriteFlowStatus flow={settlementFlow} onRetry={() => { if (lastSettlement) settlementMutation.mutate(lastSettlement); }} checkHref="/empties" checkLabel="Check empties" showFieldErrors />
          <WriteFlowStatus flow={reverseFlow} onRetry={() => { if (lastCorrection) correctionMutation.mutate(lastCorrection); }} checkHref="/empties" checkLabel="Check empties" showFieldErrors />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Record opening empties debt" description="Use this for what you already owe before the new purchase tracking. It does not infer debt from old purchases." />
        <CardBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {supplierId === undefined ? (
              <FormField id="opening-supplier" label="Supplier">
                <Select id="opening-supplier" value={resolvedSupplierId} onChange={(event) => setSelectedSupplierId(event.target.value)}>
                  <option value="">Choose a supplier</option>
                  {(suppliers.data ?? []).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                </Select>
              </FormField>
            ) : (
              <div className="rounded-md bg-muted p-3 text-sm">
                Supplier: {supplierName ?? "this supplier"}
              </div>
            )}
            <FormField id="opening-type" label="Empties type">
              <Select id="opening-type" value={openingTypeId} onChange={(event) => setOpeningTypeId(event.target.value)}>
                <option value="">Choose a container type</option>
                {openingTypes.map((type) => <option key={type.id} value={type.id}>{type.ownerName} · {type.label} ({type.kind.toLowerCase()})</option>)}
              </Select>
            </FormField>
            <FormField id="opening-quantity" label="Quantity">
              <Input id="opening-quantity" type="number" min="1" step="1" value={openingQuantity} onChange={(event) => setOpeningQuantity(event.target.value)} />
            </FormField>
            <FormField id="opening-note" label="Reason (required)">
              <Input id="opening-note" value={openingNote} onChange={(event) => setOpeningNote(event.target.value)} maxLength={500} placeholder="Why this opening debt is being entered" />
            </FormField>
          </div>
          {openingError && <p role="alert" className="text-sm text-danger">{openingError}</p>}
          <div className="flex justify-end">
            <Button
              type="button"
              variant="secondary"
              loading={openingMutation.isPending}
              disabled={
                network.offline || openingMutation.isPending || openingFlow.status === "unknown" ||
                resolvedSupplierId === "" || openingTypeId === "" || !/^[1-9]\d*$/.test(openingQuantity) ||
                openingNote.trim() === ""
              }
              onClick={() => {
                if (!/^[1-9]\d*$/.test(openingQuantity)) {
                  setOpeningError("Enter a positive whole number of empties.");
                  return;
                }
                setOpeningError("");
                openingMutation.mutate({
                  supplierId: resolvedSupplierId,
                  typeId: openingTypeId,
                  quantity: Number(openingQuantity),
                  note: openingNote.trim(),
                });
              }}
            >
              Record opening debt
            </Button>
          </div>
          <WriteFlowStatus flow={openingFlow} onRetry={() => { if (lastOpening) openingMutation.mutate(lastOpening); }} checkHref="/empties" checkLabel="Check empties" showFieldErrors />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Empties debt history" description="Purchase and opening debts are shown separately from each return." />
        <CardBody className="space-y-3">
          {debts.isPending ? <Skeleton variant="row" count={2} /> : (debts.data?.pages.flatMap((page) => page.items) ?? [])
            .filter((row) => supplierId === undefined ? selectedSupplierId === "" || row.supplierId === selectedSupplierId : true)
            .map((row) => (
              <div key={row.id} className="border-b border-border pb-3 text-sm last:border-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {row.supplierName} · {row.ownerName} · {row.typeLabel} · {row.purchaseId
                      ? `Purchase ${row.purchaseReference ?? row.purchaseId.slice(0, 8)}`
                      : "Opening debt"}
                  </span>
                  <span className="text-muted-foreground">{new Date(row.createdAt).toLocaleDateString()}</span>
                </div>
                <p className="mt-1 text-muted-foreground">
                  Originally owed: {containerLabel(row.kind, row.originalQuantity)} · Remaining: {containerLabel(row.kind, row.quantity)}
                </p>
              </div>
            ))}
          {debts.hasNextPage && <Button type="button" variant="secondary" onClick={() => void debts.fetchNextPage()} disabled={debts.isFetchingNextPage}>Load more debt history</Button>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Recent empties returns" description="Correct a return from its source record; ledger entries are not edited." />
        <CardBody className="space-y-3">
          {settlements.isPending ? <Skeleton variant="row" count={2} /> : settlementRows
            .filter((row) => supplierId === undefined ? selectedSupplierId === "" || row.supplierId === selectedSupplierId : true)
            .map((row) => (
              <div key={row.id} className="border-b border-border pb-3 text-sm last:border-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{row.label} · {containerLabel(row.kind, row.quantity)}{row.reversed ? " (corrected)" : ""}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{new Date(row.occurredAt).toLocaleDateString()}</span>
                    {!row.reversed && (
                      <Button type="button" size="sm" variant="ghost" onClick={() => {
                        setCorrectionTarget(row.id);
                        setCorrectionReason("");
                        setCorrectionError("");
                      }}>
                        <Undo2 aria-hidden="true" className="h-3.5 w-3.5" />
                        Correct
                      </Button>
                    )}
                  </div>
                </div>
                {correctionTarget === row.id && (
                  <div className="mt-3 space-y-2 rounded-md bg-muted p-3">
                    <FormField id={`settlement-correction-${row.id}`} label="Why is this return being corrected?" required>
                      <Input id={`settlement-correction-${row.id}`} value={correctionReason} maxLength={500} onChange={(event) => {
                        setCorrectionReason(event.target.value);
                        reverseFlow.edit();
                      }} />
                    </FormField>
                    {correctionError && <p role="alert" className="text-sm text-danger">{correctionError}</p>}
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="secondary" onClick={() => setCorrectionTarget("")}>Cancel</Button>
                      <Button type="button" variant="danger" loading={correctionMutation.isPending} disabled={correctionReason.trim() === "" || correctionMutation.isPending || reverseFlow.status === "unknown"} onClick={() => {
                        if (correctionReason.trim() === "") {
                          setCorrectionError("Enter a reason before correcting this return.");
                          return;
                        }
                        correctionMutation.mutate({ id: row.id, reason: correctionReason.trim() });
                      }}>Correct return</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          {settlements.hasNextPage && <Button type="button" variant="secondary" onClick={() => void settlements.fetchNextPage()} disabled={settlements.isFetchingNextPage}>Load more returns</Button>}
        </CardBody>
      </Card>
    </div>
  );
}
