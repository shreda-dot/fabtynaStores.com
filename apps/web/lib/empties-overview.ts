import type { EmptiesOverviewOwnerDto } from "./api/empties.api";

export function overviewCountRows(
  owner: EmptiesOverviewOwnerDto,
): Array<{ label: string; value: number }> {
  return [
    { label: "Empty crates", value: owner.emptyCrates },
    { label: "Full crates (in the warehouse)", value: owner.fullCrates },
    { label: "Loose bottles in the warehouse", value: owner.looseUnitsInWarehouse },
    { label: "Bottles on the shelf and market", value: owner.bottlesOnShelfAndMarket },
  ];
}

export function formatEmptiesCount(value: number): string {
  return new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 }).format(value);
}
