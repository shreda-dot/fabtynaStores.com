"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { WriteFlowStatus } from "@/components/write-flow-status";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { useWriteFlow } from "@/hooks/use-write-flow";
import { emptiesApi, isMockApiMode } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import { formatEmptiesCount } from "@/lib/empties-overview";
import { queryKeys } from "@/lib/query-keys";
import { toast } from "@/stores/toast-store";

type CountDraft = { emptyCrates: string; looseBottles: string };

function parseCount(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed <= 2_147_483_647 ? parsed : null;
}

export default function EmptiesRecountPage() {
  const queryClient = useQueryClient();
  const network = useNetworkStatus();
  const beginFlow = useWriteFlow();
  const submitFlow = useWriteFlow();
  const [drafts, setDrafts] = useState<Record<string, CountDraft>>({});
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState("");
  const [lastBegin, setLastBegin] = useState(false);
  const [lastSubmission, setLastSubmission] = useState<{
    counts: Array<{ typeId: string; emptyCrates: number; looseBottles: number }>;
    reason: string;
  } | null>(null);

  const recount = useQuery({
    queryKey: queryKeys.empties.sizeClassRecount,
    queryFn: () => emptiesApi.getSizeClassRecount(),
    enabled: !isMockApiMode,
  });

  const beginMutation = useMutation({
    mutationFn: async () => {
      if (beginFlow.status === "failed") beginFlow.edit();
      setLastBegin(true);
      return beginFlow.run(
        "empties.sizeClassRecount.begin",
        (key) => emptiesApi.beginSizeClassRecount(key),
      );
    },
    onSuccess: async (result) => {
      if (!result) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.empties.sizeClassRecount });
      await queryClient.invalidateQueries({ queryKey: queryKeys.empties.overview });
    },
    onError: (error) => toast.error(toUserMessage(error)),
  });

  const submitMutation = useMutation({
    mutationFn: async (input: NonNullable<typeof lastSubmission>) => {
      const isRetry = JSON.stringify(input) === JSON.stringify(lastSubmission);
      if (submitFlow.status === "unknown" && !isRetry) return undefined;
      if (submitFlow.status === "failed" && !isRetry) submitFlow.edit();
      setLastSubmission(input);
      return submitFlow.run(
        "empties.sizeClassRecount.submit",
        (key) => emptiesApi.submitSizeClassRecount(input, key),
      );
    },
    onSuccess: async (result) => {
      if (!result) return;
      setFormError("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.empties.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.empties.sizeClassRecount });
    },
    onError: (error) => toast.error(toUserMessage(error)),
  });

  const busy = beginMutation.isPending || beginFlow.status === "unknown";
  const submitting = submitMutation.isPending || submitFlow.status === "unknown";
  const data = recount.data;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || data.phase !== "RECOUNT_PENDING") return;
    const counts: Array<{ typeId: string; emptyCrates: number; looseBottles: number }> = [];
    for (const sizeClass of data.classes) {
      const draft = drafts[sizeClass.typeId] ?? { emptyCrates: "", looseBottles: "" };
      const emptyCrates = parseCount(draft.emptyCrates);
      const looseBottles = parseCount(draft.looseBottles);
      if (emptyCrates === null || looseBottles === null) {
        setFormError(`Enter whole-number crate and loose-bottle counts for ${sizeClass.ownerName} · ${sizeClass.capacity}.`);
        return;
      }
      if (looseBottles >= sizeClass.capacity) {
        setFormError(`Loose bottles for ${sizeClass.ownerName} · ${sizeClass.capacity} must be fewer than ${sizeClass.capacity}.`);
        return;
      }
      counts.push({ typeId: sizeClass.typeId, emptyCrates, looseBottles });
    }
    const trimmedReason = reason.trim();
    if (trimmedReason === "") {
      setFormError("A reason is required to confirm the recount.");
      return;
    }
    setFormError("");
    submitMutation.mutate({ counts, reason: trimmedReason });
  }

  if (isMockApiMode) {
    return (
      <div className="space-y-6">
        <PageHeader title="Count empty bottles" description="Record the physical count for each brewery size class." />
        <EmptyState title="Not available with demo data" description="Size-class recounts require the real server." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Count empty bottles"
        description="Count crates made of empty bottles and any loose remainder for each brewery size."
      />
      <Link href="/empties" className={buttonClasses({ variant: "secondary" })}>
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Back to empties
      </Link>

      {recount.isPending || data === undefined ? (
        <Skeleton variant="stat" count={2} />
      ) : recount.isError ? (
        <ErrorState
          title="Size-class counts could not be loaded"
          message={toUserMessage(recount.error)}
          onRetry={() => void recount.refetch()}
        />
      ) : data.phase !== "RECOUNT_PENDING" ? (
        <Card>
          <CardHeader
            title={data.phase === "READY" ? "Recount confirmed" : "Initial recount required"}
            description={
              data.phase === "READY"
                ? "Starting a new recount pauses sales and returnable purchases until the counts are confirmed."
                : "Starting the recount pauses sales and returnable purchases while you enter physical counts."
            }
          />
          <CardBody className="space-y-4">
            {data.classes.length === 0 ? (
              <EmptyState
                icon={ClipboardCheck}
                title="No active size classes"
                description="Create an active bottle type with a 12, 20, or 24 bottle capacity before starting a count."
                action={<Link href="/empties/types" className={buttonClasses({ variant: "secondary" })}>Manage owners &amp; types</Link>}
              />
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Active classes: {data.classes.map((row) => `${row.ownerName} · ${row.capacity}`).join(", ")}.
                  Confirm product size mappings before purchases resume.
                </p>
                <Button
                  loading={beginMutation.isPending}
                  disabled={busy || network.offline}
                  onClick={() => beginMutation.mutate()}
                >
                  Start recount and pause operations
                </Button>
                <WriteFlowStatus
                  flow={beginFlow}
                  onRetry={() => {
                    if (lastBegin) beginMutation.mutate();
                  }}
                  checkHref="/empties"
                  checkLabel="Check empties"
                  showFieldErrors
                />
              </>
            )}
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="Recount in progress"
            description="Sales and returnable purchases are paused. Enter the count for every active size class, then confirm once."
          />
          <CardBody className="space-y-4">
            {data.classes.length === 0 ? (
              <EmptyState title="No active size classes" description="Add an active sized bottle type, then reload this page." />
            ) : (
              <form className="space-y-4" onSubmit={submit}>
                {data.classes.map((sizeClass) => (
                  <section key={sizeClass.typeId} className="rounded-md border border-border p-3">
                    <div className="mb-3">
                      <h2 className="font-medium">{sizeClass.ownerName} · {sizeClass.label}</h2>
                      <p className="text-sm text-muted-foreground">
                        {formatEmptiesCount(sizeClass.capacity)} bottles per crate · current ledger: {formatEmptiesCount(sizeClass.quantity)} bottles
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <FormField id={`count-crates-${sizeClass.typeId}`} label="Empty crates" hint="Count crates filled with empty bottles.">
                        <Input
                          id={`count-crates-${sizeClass.typeId}`}
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          value={drafts[sizeClass.typeId]?.emptyCrates ?? ""}
                          onChange={(event) => {
                            submitFlow.edit();
                            setDrafts((current) => ({
                              ...current,
                              [sizeClass.typeId]: {
                                ...(current[sizeClass.typeId] ?? { emptyCrates: "", looseBottles: "" }),
                                emptyCrates: event.target.value,
                              },
                            }));
                          }}
                        />
                      </FormField>
                      <FormField id={`count-loose-${sizeClass.typeId}`} label="Loose bottles" hint={`Enter 0 to ${sizeClass.capacity - 1}; do not include bottles in crates.`}>
                        <Input
                          id={`count-loose-${sizeClass.typeId}`}
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          value={drafts[sizeClass.typeId]?.looseBottles ?? ""}
                          onChange={(event) => {
                            submitFlow.edit();
                            setDrafts((current) => ({
                              ...current,
                              [sizeClass.typeId]: {
                                ...(current[sizeClass.typeId] ?? { emptyCrates: "", looseBottles: "" }),
                                looseBottles: event.target.value,
                              },
                            }));
                          }}
                        />
                      </FormField>
                    </div>
                  </section>
                ))}
                <FormField id="size-class-recount-reason" label="Reason" required>
                  <Textarea
                    id="size-class-recount-reason"
                    value={reason}
                    maxLength={500}
                    rows={2}
                    placeholder="For example: opening count after launch"
                    onChange={(event) => {
                      submitFlow.edit();
                      setReason(event.target.value);
                    }}
                  />
                </FormField>
                {formError !== "" && <p role="alert" className="text-sm text-danger">{formError}</p>}
                <Button type="submit" loading={submitMutation.isPending} disabled={submitting || network.offline}>
                  Confirm all counts
                </Button>
                <WriteFlowStatus
                  flow={submitFlow}
                  onRetry={() => {
                    if (lastSubmission) submitMutation.mutate(lastSubmission);
                  }}
                  checkHref="/empties"
                  checkLabel="Check empties"
                  showFieldErrors
                />
              </form>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
