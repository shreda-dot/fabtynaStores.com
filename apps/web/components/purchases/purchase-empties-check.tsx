"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ProductDto, Unit } from "@fabtyna/shared";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { isMockApiMode, purchasesApi } from "@/lib/api";
import { toUserMessage } from "@/lib/api/client";
import type { PurchaseEmptiesPreviewInput } from "@/lib/api/empties.api";
import { formatEmptiesCount } from "@/lib/empties-overview";
import { queryKeys } from "@/lib/query-keys";
import { parseQuantityText, quantityToWholeUnits } from "@fabtyna/shared";

export type PurchaseEmptiesLine = {
  id: string;
  productId: string;
  unit: Unit;
  quantity: string;
  emptiesCrateCount?: string;
};

export type EmptiesShortageResolution = {
  suppliedFree: string;
  owed: string;
};

export function parseEmptiesShortageResolution(
  draft: EmptiesShortageResolution,
  shortage: number,
): { suppliedFree: number; owed: number } | null {
  const parse = (value: string) => value === "" ? 0 : /^\d+$/.test(value) ? Number(value) : NaN;
  const suppliedFree = parse(draft.suppliedFree);
  const owed = parse(draft.owed);
  return Number.isSafeInteger(suppliedFree) && Number.isSafeInteger(owed) &&
    suppliedFree + owed === shortage ? { suppliedFree, owed } : null;
}

export function PurchaseEmptiesCheck({
  lines,
  products,
  supplierId,
  amendingPurchaseId,
  resolutions,
  onCrateCountChange,
  onResolutionChange,
}: {
  lines: PurchaseEmptiesLine[];
  products: Map<string, ProductDto>;
  supplierId: string;
  amendingPurchaseId?: string;
  resolutions: Record<string, EmptiesShortageResolution>;
  onCrateCountChange: (lineId: string, value: string, isSuggestion: boolean) => void;
  onResolutionChange: (typeId: string, value: EmptiesShortageResolution) => void;
}) {
  const initializedCounts = useRef<Record<string, string>>({});
  const editedCounts = useRef<Record<string, boolean>>({});
  const lineIds: string[] = [];
  const previewLines: PurchaseEmptiesPreviewInput["lines"] = [];
  for (const line of lines) {
    const product = products.get(line.productId);
    const parsed = parseQuantityText(line.quantity);
    if (!product || !parsed.ok || line.productId === "") continue;
    if (quantityToWholeUnits(parsed.scaledQuantity, line.unit, product.unitsPerPack) === null) continue;
    const quantity = parsed.jsonNumber;
    previewLines.push({
      productId: line.productId,
      unit: line.unit,
      quantity,
      ...(line.emptiesCrateCount !== undefined && /^\d+$/.test(line.emptiesCrateCount)
        ? { emptiesCrateCount: Number(line.emptiesCrateCount) }
        : {}),
    });
    lineIds.push(line.id);
  }
  const input: PurchaseEmptiesPreviewInput | null = previewLines.length > 0
    ? { lines: previewLines, ...(amendingPurchaseId ? { amendingPurchaseId } : {}) }
    : null;
  const inputJson = input === null ? "" : JSON.stringify(input);
  const debouncedInputJson = useDebouncedValue(inputJson, 300);
  const current = debouncedInputJson === inputJson;
  const previewQuery = useQuery({
    queryKey: queryKeys.purchases.emptiesPreview(debouncedInputJson),
    queryFn: () => purchasesApi.previewEmpties(JSON.parse(debouncedInputJson) as PurchaseEmptiesPreviewInput),
    enabled: !isMockApiMode && debouncedInputJson !== "",
    staleTime: 0,
    retry: false,
  });
  const preview = previewQuery.data;
  const lineByIndex = lineIds;

  useEffect(() => {
    if (!preview || !current) return;
    for (const result of preview.lines) {
      const lineId = lineByIndex[result.index];
      if (!lineId) continue;
      const line = lines.find((candidate) => candidate.id === lineId);
      if (!line) continue;
      for (const requirement of result.requirements) {
        if (!requirement.manualCrateCount || editedCounts.current[lineId]) continue;
        const suggested = line.unit === "UNIT" ? "0" : String(requirement.suggestedCrateCount ?? "");
        const currentCount = line.emptiesCrateCount;
        const previousSuggestion = initializedCounts.current[lineId];
        const shouldApplySuggestion = currentCount === undefined
          ? previousSuggestion !== suggested
          : currentCount === previousSuggestion && currentCount !== suggested;
        if (
          suggested !== "" &&
          shouldApplySuggestion
        ) {
          initializedCounts.current[lineId] = suggested;
          onCrateCountChange(lineId, suggested, true);
        }
      }
    }
  });

  if (isMockApiMode || previewLines.length === 0) return null;

  const failedMessage = previewQuery.isError ? toUserMessage(previewQuery.error) : "";
  const manualCrateLines = (preview?.lines ?? []).flatMap((result) => {
    const lineId = lineByIndex[result.index];
    const line = lines.find((candidate) => candidate.id === lineId);
    return result.requirements
      .filter((requirement) => requirement.manualCrateCount)
      .map((requirement) => ({ lineId, line, requirement }));
  });
  const shortfalls = (preview?.totals ?? []).filter((total) => total.shortage > 0);

  return (
    <div className="space-y-3">
      {previewQuery.isError && current ? (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger-surface p-3 text-sm text-danger">
          <p>{failedMessage}</p>
          {/Purchase empties setup|classify this product|container setup/i.test(failedMessage) && (
            <Link href="/empties/purchase-setup" className="mt-1 inline-block font-medium underline">
              Open Purchase empties setup
            </Link>
          )}
        </div>
      ) : preview && current ? (
        <>
          {manualCrateLines.map(({ lineId, line, requirement }) => {
            if (!lineId || !line) return null;
            const partialPack = line.unit === "PACK";
            return (
              <FormField
                key={`${lineId}-${requirement.typeId}`}
                id={`empties-crate-count-${lineId}`}
                label={partialPack ? `Whole ${requirement.kind.toLowerCase()}s delivered` : "Whole crates delivered (optional)"}
                hint={partialPack
                  ? `Suggested ${formatEmptiesCount(requirement.suggestedCrateCount ?? 0)}, based on the pack quantity. Change it to the actual crates delivered.`
                  : "This is separate from the product unit count. Defaults to 0."}
              >
                <Input
                  id={`empties-crate-count-${lineId}`}
                  type="number"
                  min="0"
                  step="1"
                  value={line.emptiesCrateCount ?? (partialPack ? String(requirement.suggestedCrateCount ?? "") : "0")}
                  onChange={(event) => {
                    editedCounts.current[lineId] = true;
                    onCrateCountChange(lineId, event.target.value, false);
                  }}
                />
              </FormField>
            );
          })}
          {shortfalls.map((shortage) => {
            const draft = resolutions[shortage.typeId] ?? {
              suppliedFree: String(shortage.shortage),
              owed: "0",
            };
            const split = parseEmptiesShortageResolution(draft, shortage.shortage);
            const container = shortage.kind === "CRATE" ? "crate" : "bottle";
            return (
              <div key={shortage.typeId} className="rounded-md border border-warning/40 bg-warning-surface p-3 text-sm text-warning">
                <p className="font-medium">
                  You have {formatEmptiesCount(shortage.available)} empty {container}{shortage.available === 1 ? "" : "s"}. Buying {formatEmptiesCount(shortage.required)}. Short by {formatEmptiesCount(shortage.shortage)}.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <FormField id={`free-${shortage.typeId}`} label="Supplier gave me free">
                    <Input
                      id={`free-${shortage.typeId}`}
                      type="number"
                      min="0"
                      max={shortage.shortage}
                      step="1"
                      value={draft.suppliedFree}
                      onChange={(event) => onResolutionChange(shortage.typeId, { ...draft, suppliedFree: event.target.value })}
                    />
                  </FormField>
                  <FormField id={`owed-${shortage.typeId}`} label="I owe the supplier">
                    <Input
                      id={`owed-${shortage.typeId}`}
                      type="number"
                      min="0"
                      max={shortage.shortage}
                      step="1"
                      value={draft.owed}
                      onChange={(event) => onResolutionChange(shortage.typeId, { ...draft, owed: event.target.value })}
                    />
                  </FormField>
                </div>
                <p className="mt-2">
                  {split ? `Together: ${split.suppliedFree + split.owed} of ${shortage.shortage}.` : `Enter whole numbers that add up to ${shortage.shortage}.`}
                  {Number(draft.owed) > 0 && supplierId === "" ? " Choose a supplier to record an empties debt." : ""}
                </p>
              </div>
            );
          })}
        </>
      ) : null}
    </div>
  );
}
