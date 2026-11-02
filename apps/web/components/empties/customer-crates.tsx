"use client";

import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatLagosDateTime, getLagosBusinessDate } from "@fabtyna/shared";
import { DateRangeFilter, defaultListRange } from "@/components/date-range-filter";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { Skeleton } from "@/components/ui/skeleton";
import { WriteFlowStatus } from "@/components/write-flow-status";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useLagosBusinessDate } from "@/hooks/use-lagos-business-date";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { useWriteFlow } from "@/hooks/use-write-flow";
import { customersApi, emptiesApi, isMockApiMode } from "@/lib/api";
import type {
  EmptiesCustomerBalanceDto,
  EmptiesCustomerMovementDto,
  EmptiesCustomerMovementType,
  EmptiesTypeDto,
} from "@/lib/api/empties.api";
import { toUserMessage } from "@/lib/api/client";
import { parseEmptiesQuantityText } from "@/lib/empties-quantity";
import { queryKeys } from "@/lib/query-keys";
import { validateReportRange } from "@/lib/report-range";

const PAGE_SIZE = 50;

const ACTIONS: Array<{ type: EmptiesCustomerMovementType; label: string }> = [
  { type: "TAKEN", label: "Customer took crates" },
  { type: "RETURNED", label: "Customer returned crates" },
  { type: "KEPT", label: "Customer kept crates" },
  { type: "ADJUSTMENT", label: "Adjust" },
];

const MOVEMENT_LABEL: Record<EmptiesCustomerMovementType, string> = {
  TAKEN: "Customer took crates",
  RETURNED: "Customer returned crates",
  KEPT: "Customer kept crates",
  ADJUSTMENT: "Adjustment",
};

type CustomerChoice = { id: string; name: string };
type NewMovement = {
  customerId: string;
  typeId: string;
  movementType: EmptiesCustomerMovementType;
  quantity: number;
  note: string;
};

function Quantity({ value }: { value: number }) {
  return (
    <span className={value < 0 ? "tabular text-danger" : "tabular"}>
      {value > 0 ? "+" : ""}
      {value}
    </span>
  );
}

export function CustomerCratesPanel({
  customerId,
  customerName,
  selectedCustomer,
  onSelectCustomer,
}: {
  customerId?: string;
  customerName?: string;
  selectedCustomer?: CustomerChoice | null;
  onSelectCustomer?: (customer: CustomerChoice | null) => void;
}) {
  const queryClient = useQueryClient();
  const network = useNetworkStatus();
  const today = useLagosBusinessDate() || getLagosBusinessDate();
  const fixedCustomer = customerId !== undefined;
  const [localCustomer, setLocalCustomer] = useState<CustomerChoice | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const debouncedCustomerSearch = useDebouncedValue(customerSearch, 250);
  const [movementType, setMovementType] = useState<EmptiesCustomerMovementType>("TAKEN");
  const [typeId, setTypeId] = useState("");
  const [quantityText, setQuantityText] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState("");
  const [lastMovement, setLastMovement] = useState<NewMovement | null>(null);
  const [reverseTarget, setReverseTarget] = useState<EmptiesCustomerMovementDto | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [lastReverse, setLastReverse] = useState<{ id: string; reason: string } | null>(null);
  const [range, setRange] = useState(() => defaultListRange(getLagosBusinessDate()));

  const selected = fixedCustomer
    ? { id: customerId, name: customerName ?? "Customer" }
    : selectedCustomer !== undefined
      ? selectedCustomer
      : localCustomer;
  const selectedId = selected?.id;
  const rangeProblem = validateReportRange(range.from, range.to);

  const types = useQuery({
    queryKey: queryKeys.empties.types(false),
    queryFn: () => emptiesApi.listTypes(),
    enabled: !isMockApiMode,
  });
  const balances = useQuery({
    queryKey: queryKeys.empties.customerBalances({
      customerId: selectedId,
      onlyOwing: false,
    }),
    queryFn: () =>
      emptiesApi.listCustomerBalances({
        customerId: selectedId,
        onlyOwing: false,
        limit: 200,
      }),
    enabled: !isMockApiMode && selectedId !== undefined,
  });
  const customers = useInfiniteQuery({
    queryKey: queryKeys.customers.pages(debouncedCustomerSearch, false),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      customersApi.listPage({
        search: debouncedCustomerSearch,
        includeDeleted: false,
        limit: 25,
        cursor: pageParam,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !isMockApiMode && !fixedCustomer && selectedId === undefined,
  });
  const movementPages = useInfiniteQuery({
    queryKey: queryKeys.empties.customerMovementPages({
      customerId: selectedId,
      from: range.from,
      to: range.to,
    }),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      emptiesApi.listCustomerMovements({
        customerId: selectedId,
        from: range.from,
        to: range.to,
        limit: PAGE_SIZE,
        cursor: pageParam,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !isMockApiMode && selectedId !== undefined && rangeProblem === null,
  });

  const movements = movementPages.data?.pages.flatMap((page) => page.items) ?? [];
  const customersFound = customers.data?.pages.flatMap((page) => page.items) ?? [];
  const activeTypes: EmptiesTypeDto[] = types.data ?? [];
  const flow = useWriteFlow();
  const reverseFlow = useWriteFlow();

  const createMutation = useMutation({
    mutationFn: (operation: NewMovement) => {
      const isRetry = JSON.stringify(operation) === JSON.stringify(lastMovement);
      if (flow.status === "unknown" && !isRetry) return Promise.resolve(undefined);
      if (flow.status === "failed" && !isRetry) flow.edit();
      setLastMovement(operation);
      const messageKey =
        operation.movementType === "TAKEN"
          ? "empties.customer.taken"
          : operation.movementType === "RETURNED"
            ? "empties.customer.returned"
            : operation.movementType === "KEPT"
              ? "empties.customer.kept"
              : "empties.customer.adjustment";
      return flow.run(
        messageKey,
        (key) =>
          emptiesApi.createCustomerMovement(
            {
              customerId: operation.customerId,
              typeId: operation.typeId,
              movementType: operation.movementType,
              quantity: operation.quantity,
              note: operation.note.trim() || undefined,
            },
            key,
          ),
        { name: selected?.name },
      );
    },
    onSuccess: async (result) => {
      if (!result) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.empties.all });
      setQuantityText("");
      setNote("");
      setLastMovement(null);
      flow.reset();
    },
  });

  const reverseMutation = useMutation({
    mutationFn: (operation: { movement: EmptiesCustomerMovementDto; reason: string }) => {
      const isRetry =
        operation.movement.id === lastReverse?.id && operation.reason === lastReverse.reason;
      if (reverseFlow.status === "unknown" && !isRetry) return Promise.resolve(undefined);
      if (reverseFlow.status === "failed" && !isRetry) reverseFlow.edit();
      setLastReverse({ id: operation.movement.id, reason: operation.reason });
      return reverseFlow.run("empties.customer.reverse", (key) =>
        emptiesApi.reverseCustomerMovement(operation.movement.id, operation.reason, key),
      );
    },
    onSuccess: async (result) => {
      if (!result) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.empties.all });
      setReverseTarget(null);
      setReverseReason("");
      setLastReverse(null);
      reverseFlow.reset();
    },
  });

  function chooseCustomer(choice: CustomerChoice | null) {
    if (onSelectCustomer) onSelectCustomer(choice);
    else setLocalCustomer(choice);
    setCustomerSearch("");
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedId === undefined) {
      setFormError("Choose a customer.");
      return;
    }
    if (!typeId) {
      setFormError("Choose an empties type.");
      return;
    }
    const parsed = parseEmptiesQuantityText(quantityText, {
      allowNegative: movementType === "ADJUSTMENT",
    });
    if (!parsed.ok) {
      setFormError(parsed.message);
      return;
    }
    if ((movementType === "KEPT" || movementType === "ADJUSTMENT") && note.trim() === "") {
      setFormError(movementType === "KEPT" ? "A note is required when the customer keeps crates." : "A reason is required for an adjustment.");
      return;
    }
    setFormError("");
    createMutation.mutate({
      customerId: selectedId,
      typeId,
      movementType,
      quantity: parsed.quantity,
      note,
    });
  }

  if (isMockApiMode) {
    return (
      <EmptyState
        title="Not available with demo data"
        description="Customer crate tracking needs the real server."
      />
    );
  }

  if (!fixedCustomer && selected === null) {
    return (
      <Card>
        <CardHeader title="Customer crate activity" description="Search the customer directory, then record or review crates owed." />
        <CardBody className="space-y-3">
          <FormField id="crate-customer-search" label="Find a customer">
            <Input
              id="crate-customer-search"
              value={customerSearch}
              onChange={(event) => setCustomerSearch(event.target.value)}
              placeholder="Search by name, phone or email"
            />
          </FormField>
          {customers.isPending ? (
            <Skeleton variant="row" count={3} />
          ) : customers.isError ? (
            <ErrorState message={toUserMessage(customers.error)} onRetry={() => void customers.refetch()} />
          ) : customersFound.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active customers match this search.</p>
          ) : (
            <div className="space-y-2">
              {customersFound.map((customer) => (
                <Button
                  key={customer.id}
                  variant="secondary"
                  className="w-full justify-start"
                  onClick={() => chooseCustomer({ id: customer.id, name: customer.name })}
                >
                  {customer.name}{customer.phone ? ` · ${customer.phone}` : ""}
                </Button>
              ))}
              {customers.hasNextPage && (
                <div className="flex justify-center">
                  <Button
                    variant="ghost"
                    loading={customers.isFetchingNextPage}
                    onClick={() => void customers.fetchNextPage()}
                  >
                    Load more customers
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    );
  }

  if (types.isError) {
    return <ErrorState message={toUserMessage(types.error)} onRetry={() => void types.refetch()} />;
  }

  return (
    <div className="space-y-4">
      {!fixedCustomer && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">{selected?.name}</p>
          <Button variant="ghost" size="sm" onClick={() => chooseCustomer(null)}>
            Change customer
          </Button>
        </div>
      )}
      <Card>
        <CardHeader title={fixedCustomer ? "Crates owed" : "Record crate activity"} />
        <CardBody className="space-y-4">
          {balances.isPending ? (
            <Skeleton variant="row" count={2} />
          ) : balances.isError ? (
            <ErrorState message={toUserMessage(balances.error)} onRetry={() => void balances.refetch()} />
          ) : balances.data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">This customer currently owes no empties.</p>
          ) : (
            <ul className="space-y-2">
              {balances.data.items.map((balance) => (
                <li
                  key={balance.typeId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted p-3 text-sm"
                >
                  <span>{balance.kind === "CRATE" ? "Crate" : "Bottle"} · {balance.ownerName} · {balance.label}</span>
                  <span className="flex items-center gap-2 font-medium">
                    {balance.quantity} owed
                    {balance.valueKobo !== null && <Money kobo={balance.valueKobo} tone="neutral" />}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {types.isPending ? (
            <Skeleton variant="row" count={2} />
          ) : activeTypes.length === 0 ? (
            <EmptyState title="No active empties types" description="Add a brewery and its crate type before recording customer crate movements." />
          ) : (
            <form className="space-y-3" onSubmit={submit}>
              <FormField id="customer-crate-action" label="Action">
                <Select
                  id="customer-crate-action"
                  value={movementType}
                  onChange={(event) => {
                    flow.edit();
                    setMovementType(event.target.value as EmptiesCustomerMovementType);
                  }}
                >
                  {ACTIONS.map((action) => (
                    <option key={action.type} value={action.type}>{action.label}</option>
                  ))}
                </Select>
              </FormField>
              <FormField id="customer-crate-type" label="Brewery crate type">
                <Select
                  id="customer-crate-type"
                  value={typeId}
                  onChange={(event) => {
                    flow.edit();
                    setTypeId(event.target.value);
                  }}
                >
                  <option value="">Choose a type</option>
                  {activeTypes.map((type) => (
                    <option key={type.id} value={type.id}>{type.kind === "CRATE" ? "Crate" : "Bottle"} · {type.ownerName} · {type.label}</option>
                  ))}
                </Select>
              </FormField>
              <FormField
                id="customer-crate-quantity"
                label={movementType === "ADJUSTMENT" ? "Adjustment (use minus to reduce)" : "Quantity"}
                hint={movementType === "ADJUSTMENT" ? "Whole numbers only; enter a positive or negative count." : "Enter a positive whole number."}
              >
                <Input
                  id="customer-crate-quantity"
                  type="text"
                  inputMode="numeric"
                  value={quantityText}
                  onChange={(event) => {
                    flow.edit();
                    setQuantityText(event.target.value);
                  }}
                  placeholder={movementType === "ADJUSTMENT" ? "e.g. 3 or -2" : "e.g. 3"}
                />
              </FormField>
              <FormField
                id="customer-crate-note"
                label={movementType === "ADJUSTMENT" ? "Reason" : "Note"}
                required={movementType === "KEPT" || movementType === "ADJUSTMENT"}
              >
                <Textarea
                  id="customer-crate-note"
                  value={note}
                  onChange={(event) => {
                    flow.edit();
                    setNote(event.target.value);
                  }}
                  maxLength={500}
                  rows={2}
                  placeholder={movementType === "KEPT" ? "Why is the customer keeping the crates?" : "Optional"}
                />
              </FormField>
              {formError && <p role="alert" className="text-sm text-danger">{formError}</p>}
              <Button type="submit" loading={createMutation.isPending} disabled={network.offline || flow.status === "unknown"}>
                Record activity
              </Button>
              <WriteFlowStatus
                flow={flow}
                onRetry={() => {
                  if (lastMovement) createMutation.mutate(lastMovement);
                }}
                checkHref={fixedCustomer ? `/customers/${customerId}` : "/empties/customers"}
                checkLabel="Check customer crates"
                showFieldErrors
              />
            </form>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Crate movement history" description="Values are display-only and do not enter cash or profit." />
        <CardBody className="space-y-4">
          <DateRangeFilter
            idPrefix="customer-crates"
            from={range.from}
            to={range.to}
            today={today}
            onChange={setRange}
            problem={rangeProblem}
          />
          {rangeProblem !== null ? null : movementPages.isPending ? (
            <Skeleton variant="row" count={4} />
          ) : movementPages.isError ? (
            <ErrorState message={toUserMessage(movementPages.error)} onRetry={() => void movementPages.refetch()} />
          ) : movements.length === 0 ? (
            <EmptyState title="No crate movements" description="Recorded customer crate activity will appear here." />
          ) : (
            <div className="space-y-3">
              {movements.map((movement) => (
                <div key={movement.id} className="space-y-2 rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{MOVEMENT_LABEL[movement.movementType]} · {movement.ownerName} · {movement.label}</p>
                      <p className="text-sm text-muted-foreground">{formatLagosDateTime(movement.occurredAt)}</p>
                    </div>
                    <div className="text-right">
                      <Quantity value={movement.quantity} />
                      {movement.valueKobo !== null && <p className="text-sm"><Money kobo={movement.valueKobo} tone="neutral" /></p>}
                    </div>
                  </div>
                  {movement.note && <p className="text-sm text-muted-foreground">{movement.note}</p>}
                  {movement.reversesEntryId !== null ? (
                    <p className="text-xs text-muted-foreground">Reversal</p>
                  ) : movement.reversedByEntryId === null ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger"
                      onClick={() => {
                        setReverseTarget(movement);
                        setReverseReason("");
                      }}
                    >
                      Reverse
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground">Reversed</p>
                  )}
                  {reverseTarget?.id === movement.id && (
                    <form
                      className="space-y-2 border-t border-border pt-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!reverseReason.trim()) return;
                        reverseMutation.mutate({ movement, reason: reverseReason.trim() });
                      }}
                    >
                      <FormField id={`reverse-reason-${movement.id}`} label="Reason for reversal" required>
                        <Textarea
                          id={`reverse-reason-${movement.id}`}
                          value={reverseReason}
                          onChange={(event) => {
                            reverseFlow.edit();
                            setReverseReason(event.target.value);
                          }}
                          maxLength={500}
                          rows={2}
                        />
                      </FormField>
                      {reverseReason.trim() === "" && <p className="text-sm text-danger">A reason is required.</p>}
                      <div className="flex gap-2">
                        <Button type="submit" variant="danger" loading={reverseMutation.isPending} disabled={network.offline || reverseReason.trim() === ""}>
                          Reverse movement
                        </Button>
                        <Button type="button" variant="secondary" onClick={() => setReverseTarget(null)}>
                          Cancel
                        </Button>
                      </div>
                      <WriteFlowStatus
                        flow={reverseFlow}
                        onRetry={() => {
                          if (reverseTarget) reverseMutation.mutate({ movement: reverseTarget, reason: reverseReason.trim() });
                        }}
                        checkHref={fixedCustomer ? `/customers/${customerId}` : "/empties/customers"}
                        checkLabel="Check customer crates"
                        showFieldErrors
                      />
                    </form>
                  )}
                </div>
              ))}
              {movementPages.hasNextPage && (
                <div className="flex justify-center">
                  <Button variant="secondary" loading={movementPages.isFetchingNextPage} onClick={() => void movementPages.fetchNextPage()}>
                    Load more
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export type CustomerCrateBalanceRow = EmptiesCustomerBalanceDto;
