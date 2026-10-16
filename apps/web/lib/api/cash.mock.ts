import {
  createCashSnapshotDtoSchema,
  fromAuditLogDto,
  toAuditLogDto,
  toCashSnapshotDto,
  validateCashSnapshot,
  type CashSnapshot,
} from "@fabtyna/shared";
import type { CashApi } from "./cash.api";
import { newId, readMockStore, transactMockStore } from "./mock-store";
import { mockDelay } from "./mock-transport";

function delay(): Promise<void> {
  return mockDelay();
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Latest by business date, then by creation time. */
function latestSnapshot(snapshots: readonly CashSnapshot[]): CashSnapshot | null {
  let latest: CashSnapshot | null = null;
  for (const snapshot of snapshots) {
    if (latest === null) {
      latest = snapshot;
      continue;
    }
    if (snapshot.asOfDate > latest.asOfDate) {
      latest = snapshot;
    } else if (
      snapshot.asOfDate === latest.asOfDate &&
      snapshot.createdAt.getTime() >= latest.createdAt.getTime()
    ) {
      latest = snapshot;
    }
  }
  return latest;
}

export const cashMockApi: CashApi = {
  async list() {
    await delay();
    const store = readMockStore();
    const items = store.cashSnapshots
      .slice()
      .sort((a, b) => {
        if (a.asOfDate !== b.asOfDate) return b.asOfDate.localeCompare(a.asOfDate);
        return b.createdAt.getTime() - a.createdAt.getTime();
      })
      .map(toCashSnapshotDto);
    return jsonClone(items);
  },

  async latest() {
    await delay();
    const store = readMockStore();
    const latest = latestSnapshot(store.cashSnapshots);
    return latest ? jsonClone(toCashSnapshotDto(latest)) : null;
  },

  async recordSnapshot(input) {
    await delay();
    const data = createCashSnapshotDtoSchema.parse(input);
    const snapshot: CashSnapshot = {
      id: newId(),
      asOfDate: data.asOfDate,
      amountKobo: BigInt(data.amountKobo),
      note: data.note,
      createdAt: new Date(),
    };
    validateCashSnapshot(snapshot);
    transactMockStore((draft) => {
      draft.cashSnapshots.push(snapshot);
      draft.auditLogs.push(
        fromAuditLogDto(
          toAuditLogDto({
            id: newId(),
            actorId: null,
            action: "CASH_SNAPSHOT_RECORDED",
            entityType: "CashSnapshot",
            entityId: snapshot.id,
            beforeData: null,
            afterData: toCashSnapshotDto(snapshot),
            metadata: null,
            occurredAt: new Date(),
          }),
        ),
      );
      return snapshot;
    });
    return jsonClone(toCashSnapshotDto(snapshot));
  },
};
