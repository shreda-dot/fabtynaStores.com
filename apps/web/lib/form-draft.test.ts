import { beforeEach, describe, expect, it } from "vitest";
import {
  DRAFT_TTL_MS,
  clearAllDrafts,
  clearDraft,
  draftStorageKey,
  loadDraft,
  saveDraft,
  setDraftUser,
  type DraftStorage,
} from "./form-draft";

function fakeStorage(): DraftStorage & { dump: () => string[] } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
    dump: () => [...map.keys()],
  };
}

describe("form drafts", () => {
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    storage = fakeStorage();
    setDraftUser("u1");
  });

  it("saves and restores", () => {
    const key = draftStorageKey("purchase-new")!;
    saveDraft(key, { lines: [1, 2] }, { storage, now: 1000 });
    expect(loadDraft(key, { storage, now: 2000 })).toEqual({
      data: { lines: [1, 2] },
      savedAt: 1000,
    });
  });

  it("expires after exactly 2 hours: 7_200_000 ms is kept, one ms more is deleted", () => {
    const key = draftStorageKey("sale-new")!;
    saveDraft(key, { a: 1 }, { storage, now: 0 });
    expect(DRAFT_TTL_MS).toBe(7_200_000);
    expect(loadDraft(key, { storage, now: 7_200_000 })).not.toBeNull();
    expect(loadDraft(key, { storage, now: 7_200_001 })).toBeNull();
    expect(storage.dump()).toEqual([]);
  });

  it("isolates users and forms", () => {
    const a = draftStorageKey("expense-new", "u1")!;
    const b = draftStorageKey("expense-new", "u2")!;
    const c = draftStorageKey("purchase-new", "u1")!;
    expect(new Set([a, b, c]).size).toBe(3);
    expect(draftStorageKey("x", null)).toBeNull();
  });

  it("clears one draft and clears all drafts without touching other keys", () => {
    const a = draftStorageKey("a")!;
    const b = draftStorageKey("b")!;
    storage.setItem("unrelated", "keep");
    saveDraft(a, 1, { storage });
    saveDraft(b, 2, { storage });
    clearDraft(a, { storage });
    expect(loadDraft(a, { storage })).toBeNull();
    clearAllDrafts({ storage });
    expect(storage.dump()).toEqual(["unrelated"]);
  });

  it("discards a draft with another version or corrupt content", () => {
    const key = draftStorageKey("loan-new")!;
    storage.setItem(key, JSON.stringify({ v: 999, savedAt: 1, data: {} }));
    expect(loadDraft(key, { storage, now: 2 })).toBeNull();
    storage.setItem(key, "{not json");
    expect(loadDraft(key, { storage, now: 2 })).toBeNull();
    expect(storage.dump()).toEqual([]);
  });

  it("returns null and does not throw without storage", () => {
    expect(saveDraft("k", 1, { storage: null })).toBe(false);
    expect(loadDraft("k", { storage: null })).toBeNull();
  });
});
