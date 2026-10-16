import type { CashSnapshotDto, CreateCashSnapshotDto } from "@fabtyna/shared";

export interface CashApi {
  /** All snapshots, newest business date (then newest created) first. */
  list(): Promise<CashSnapshotDto[]>;
  /** The snapshot used for calculations, or null when none exists. */
  latest(): Promise<CashSnapshotDto | null>;
  recordSnapshot(input: CreateCashSnapshotDto): Promise<CashSnapshotDto>;
}
