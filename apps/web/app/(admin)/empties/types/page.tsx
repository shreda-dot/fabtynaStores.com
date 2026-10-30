"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Money } from "@/components/ui/money";
import { MoneyInput } from "@/components/money-input";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { WriteFlowStatus } from "@/components/write-flow-status";
import { useWriteFlow } from "@/hooks/use-write-flow";
import { emptiesApi, isMockApiMode } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import type { EmptiesKind } from "@/lib/api/empties.api";
import { queryKeys } from "@/lib/query-keys";
import { toast } from "@/stores/toast-store";

const KIND_LABEL: Record<EmptiesKind, string> = { BOTTLE: "Bottle", CRATE: "Crate" };

type OwnerOperation =
  | { kind: "create"; name: string }
  | { kind: "rename"; id: string; name: string }
  | { kind: "active"; id: string; isActive: boolean };

type TypeOperation =
  | {
      kind: "create";
      ownerId: string;
      typeKind: EmptiesKind;
      label: string;
      unitValueKobo: string | null;
    }
  | { kind: "patch"; id: string; label: string; unitValueKobo: string | null }
  | { kind: "active"; id: string; isActive: boolean };

export default function EmptiesTypesPage() {
  const queryClient = useQueryClient();

  const owners = useQuery({
    queryKey: queryKeys.empties.owners(true),
    queryFn: () => emptiesApi.listOwners({ includeInactive: true }),
    enabled: !isMockApiMode,
  });

  const types = useQuery({
    queryKey: queryKeys.empties.types(true),
    queryFn: () => emptiesApi.listTypes({ includeInactive: true }),
    enabled: !isMockApiMode,
  });

  const activeOwners = (owners.data ?? []).filter((owner) => owner.isActive);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Empties owners & types"
        description="Owners and their bottle and crate types. Records are never deleted, only deactivated."
        actions={
          <Link href="/empties" className={buttonClasses({ variant: "secondary" })}>
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Back to empties
          </Link>
        }
      />

      {isMockApiMode ? (
        <EmptyState
          title="Not available with demo data"
          description="Managing empties owners and types needs the real server. Switch the app to real mode to use it."
        />
      ) : (
        <>
          <OwnersSection
            owners={owners.data ?? []}
            isPending={owners.isPending}
            isError={owners.isError}
            error={owners.error}
            onRetry={() => void owners.refetch()}
            onChanged={async () => {
              await queryClient.invalidateQueries({ queryKey: queryKeys.empties.all });
            }}
          />

          <TypesSection
            types={types.data ?? []}
            activeOwners={activeOwners}
            isPending={types.isPending}
            isError={types.isError}
            error={types.error}
            onRetry={() => void types.refetch()}
            onChanged={async () => {
              await queryClient.invalidateQueries({ queryKey: queryKeys.empties.all });
            }}
          />
        </>
      )}
    </div>
  );
}

function OwnersSection({
  owners,
  isPending,
  isError,
  error,
  onRetry,
  onChanged,
}: {
  owners: { id: string; name: string; isActive: boolean; typeCount: number; activeTypeCount: number }[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  onChanged: () => Promise<void>;
}) {
  const flow = useWriteFlow();
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState("");
  const [lastOperation, setLastOperation] = useState<OwnerOperation | null>(null);

  const mutation = useMutation({
    mutationFn: async (operation: OwnerOperation) => {
      const isRetry = JSON.stringify(operation) === JSON.stringify(lastOperation);
      if (flow.status === "unknown" && !isRetry) return undefined;
      if (flow.status === "failed" && !isRetry) flow.edit();
      setLastOperation(operation);
      return flow.run((key) => {
        if (operation.kind === "create") return emptiesApi.createOwner({ name: operation.name }, key);
        if (operation.kind === "rename") return emptiesApi.renameOwner(operation.id, operation.name, key);
        return emptiesApi.setOwnerActive(operation.id, operation.isActive, key);
      });
    },
    onSuccess: async (result) => {
      if (!result) return;
      await onChanged();
      setName("");
      setEditingId("");
    },
    onError: (cause) => toast.error(toUserMessage(cause)),
  });

  const busy = mutation.isPending || flow.status === "unknown";

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") return;
    mutation.mutate(
      editingId ? { kind: "rename", id: editingId, name: trimmed } : { kind: "create", name: trimmed },
    );
  }

  return (
    <Card>
      <CardHeader title="Owners" description="Breweries or suppliers that empties are owed back to." />
      <CardBody className="space-y-4">
        <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={submit}>
          <FormField
            id="empties-owner-name"
            label={editingId ? "Rename owner" : "New owner"}
            className="flex-1"
          >
            <Input
              id="empties-owner-name"
              value={name}
              maxLength={60}
              placeholder={editingId ? "New name" : "Owner name"}
              onChange={(event) => {
                flow.edit();
                setName(event.target.value);
              }}
            />
          </FormField>
          <div className="flex gap-2">
            <Button type="submit" loading={mutation.isPending} disabled={busy}>
              {editingId ? "Save name" : "Add owner"}
            </Button>
            {editingId !== "" && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditingId("");
                  setName("");
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
        <WriteFlowStatus
          flow={flow}
          onRetry={() => {
            if (lastOperation) mutation.mutate(lastOperation);
          }}
          checkHref="/empties/types"
          checkLabel="Check owners"
          showFieldErrors
        />

        {isPending ? (
          <Skeleton variant="row" count={3} />
        ) : isError ? (
          <ErrorState
            title="Owners could not be loaded"
            message={toUserMessage(error)}
            onRetry={onRetry}
          />
        ) : owners.length === 0 ? (
          <EmptyState title="No owners yet" description="Add a brewery or supplier above." />
        ) : (
          <ul className="divide-y divide-border">
            {owners.map((owner) => (
              <li key={owner.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span className="flex flex-wrap items-center gap-2">
                  {owner.name}
                  {!owner.isActive && <Badge>Inactive</Badge>}
                  <span className="text-xs text-muted-foreground">
                    {owner.activeTypeCount} active of {owner.typeCount} type
                    {owner.typeCount === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      flow.edit();
                      setEditingId(owner.id);
                      setName(owner.name);
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      flow.edit();
                      mutation.mutate({ kind: "active", id: owner.id, isActive: !owner.isActive });
                    }}
                  >
                    {owner.isActive ? "Deactivate" : "Reactivate"}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function TypesSection({
  types,
  activeOwners,
  isPending,
  isError,
  error,
  onRetry,
  onChanged,
}: {
  types: {
    id: string;
    ownerId: string;
    ownerName: string;
    kind: EmptiesKind;
    label: string;
    unitValueKobo: string | null;
    isActive: boolean;
  }[];
  activeOwners: { id: string; name: string }[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  onChanged: () => Promise<void>;
}) {
  const flow = useWriteFlow();
  const [editingId, setEditingId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [typeKind, setTypeKind] = useState<EmptiesKind>("CRATE");
  const [label, setLabel] = useState("");
  const [unitValueKobo, setUnitValueKobo] = useState("");
  const [lastOperation, setLastOperation] = useState<TypeOperation | null>(null);

  const editing = editingId === "" ? null : types.find((type) => type.id === editingId) ?? null;

  const mutation = useMutation({
    mutationFn: async (operation: TypeOperation) => {
      const isRetry = JSON.stringify(operation) === JSON.stringify(lastOperation);
      if (flow.status === "unknown" && !isRetry) return undefined;
      if (flow.status === "failed" && !isRetry) flow.edit();
      setLastOperation(operation);
      return flow.run((key) => {
        if (operation.kind === "create") {
          return emptiesApi.createType(
            {
              ownerId: operation.ownerId,
              kind: operation.typeKind,
              label: operation.label,
              unitValueKobo: operation.unitValueKobo,
            },
            key,
          );
        }
        if (operation.kind === "patch") {
          return emptiesApi.patchType(
            operation.id,
            { label: operation.label, unitValueKobo: operation.unitValueKobo },
            key,
          );
        }
        return emptiesApi.setTypeActive(operation.id, operation.isActive, key);
      });
    },
    onSuccess: async (result) => {
      if (!result) return;
      await onChanged();
      setEditingId("");
      setLabel("");
      setUnitValueKobo("");
    },
    onError: (cause) => toast.error(toUserMessage(cause)),
  });

  const busy = mutation.isPending || flow.status === "unknown";

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedLabel = label.trim();
    if (trimmedLabel === "") return;
    const value = unitValueKobo.trim() === "" ? null : unitValueKobo;
    if (editing) {
      mutation.mutate({ kind: "patch", id: editing.id, label: trimmedLabel, unitValueKobo: value });
      return;
    }
    if (ownerId === "") return;
    mutation.mutate({
      kind: "create",
      ownerId,
      typeKind,
      label: trimmedLabel,
      unitValueKobo: value,
    });
  }

  function startEdit(type: (typeof types)[number]) {
    flow.edit();
    setEditingId(type.id);
    setLabel(type.label);
    setUnitValueKobo(type.unitValueKobo ?? "");
  }

  return (
    <Card>
      <CardHeader
        title="Types"
        description="A bottle or crate type for an owner, with an optional display value."
      />
      <CardBody className="space-y-4">
        <form className="space-y-3" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-2">
            {editing ? (
              <FormField id="empties-type-owner" label="Owner">
                <Input id="empties-type-owner" value={editing.ownerName} readOnly disabled />
              </FormField>
            ) : (
              <FormField id="empties-type-owner" label="Owner" required>
                <Select
                  id="empties-type-owner"
                  value={ownerId}
                  onChange={(event) => {
                    flow.edit();
                    setOwnerId(event.target.value);
                  }}
                >
                  <option value="">Select an owner</option>
                  {activeOwners.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            )}
            <FormField id="empties-type-kind" label="Kind" required>
              <Select
                id="empties-type-kind"
                value={editing ? editing.kind : typeKind}
                disabled={editing !== null}
                onChange={(event) => {
                  flow.edit();
                  setTypeKind(event.target.value as EmptiesKind);
                }}
              >
                <option value="CRATE">Crate</option>
                <option value="BOTTLE">Bottle</option>
              </Select>
            </FormField>
          </div>
          <FormField id="empties-type-label" label="Label" required hint="1 to 40 characters.">
            <Input
              id="empties-type-label"
              value={label}
              maxLength={40}
              placeholder="e.g. 50cl crate"
              onChange={(event) => {
                flow.edit();
                setLabel(event.target.value);
              }}
            />
          </FormField>
          <MoneyInput
            key={editingId === "" ? "new" : editingId}
            id="empties-type-unit-value"
            label="Unit value (optional, for reference only)"
            defaultValueKobo={unitValueKobo}
            onKoboChange={(value) => {
              flow.edit();
              setUnitValueKobo(value);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={mutation.isPending} disabled={busy}>
              {editing ? "Save type" : "Add type"}
            </Button>
            {editing && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditingId("");
                  setLabel("");
                  setUnitValueKobo("");
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
        <WriteFlowStatus
          flow={flow}
          onRetry={() => {
            if (lastOperation) mutation.mutate(lastOperation);
          }}
          checkHref="/empties/types"
          checkLabel="Check types"
          showFieldErrors
        />

        {isPending ? (
          <Skeleton variant="row" count={3} />
        ) : isError ? (
          <ErrorState
            title="Types could not be loaded"
            message={toUserMessage(error)}
            onRetry={onRetry}
          />
        ) : types.length === 0 ? (
          <EmptyState title="No types yet" description="Add a bottle or crate type above." />
        ) : (
          <ul className="divide-y divide-border">
            {types.map((type) => (
              <li
                key={type.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2"
              >
                <span className="flex flex-wrap items-center gap-2">
                  {type.label}
                  <Badge tone="info">{KIND_LABEL[type.kind]}</Badge>
                  <span className="text-xs text-muted-foreground">{type.ownerName}</span>
                  {type.unitValueKobo !== null && (
                    <span className="text-xs text-muted-foreground">
                      <Money kobo={type.unitValueKobo} tone="neutral" />
                    </span>
                  )}
                  {!type.isActive && <Badge>Inactive</Badge>}
                </span>
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || !type.isActive}
                    onClick={() => startEdit(type)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      flow.edit();
                      mutation.mutate({ kind: "active", id: type.id, isActive: !type.isActive });
                    }}
                  >
                    {type.isActive ? "Deactivate" : "Reactivate"}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
