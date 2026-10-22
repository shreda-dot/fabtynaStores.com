/** Drafts older than this are deleted instead of offered. */
export const DRAFT_TTL_MS = 2 * 60 * 60 * 1000;

/** Bump when a stored draft's shape changes; older drafts are discarded. */
export const DRAFT_VERSION = 1;

const PREFIX = "fabtyna:draft:";

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

type Envelope = { v: number; savedAt: number; data: unknown };

let currentUserId: string | null = null;

/** Set by AuthGuard once the session is known; drafts are keyed per user. */
export function setDraftUser(userId: string | null): void {
  currentUserId = userId;
}

export function getDraftUser(): string | null {
  return currentUserId;
}

export function draftStorageKey(form: string, userId: string | null = currentUserId): string | null {
  if (userId === null) return null;
  return `${PREFIX}${userId}:${form}`;
}

function defaultStorage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export type LoadedDraft<T> = { data: T; savedAt: number };

/** Returns a fresh, current-version draft, or null (deleting anything expired or unreadable). */
export function loadDraft<T>(
  key: string,
  options: { now?: number; storage?: DraftStorage | null } = {},
): LoadedDraft<T> | null {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  if (storage === null) return null;
  const now = options.now ?? Date.now();
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<Envelope>;
    const savedAt = parsed.savedAt;
    const valid =
      parsed.v === DRAFT_VERSION &&
      typeof savedAt === "number" &&
      now - savedAt >= 0 &&
      now - savedAt <= DRAFT_TTL_MS &&
      parsed.data !== undefined;
    if (!valid || savedAt === undefined) {
      storage.removeItem(key);
      return null;
    }
    return { data: parsed.data as T, savedAt };
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Storage unavailable: nothing to clean.
    }
    return null;
  }
}

export function saveDraft(
  key: string,
  data: unknown,
  options: { now?: number; storage?: DraftStorage | null } = {},
): boolean {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  if (storage === null) return false;
  const envelope: Envelope = { v: DRAFT_VERSION, savedAt: options.now ?? Date.now(), data };
  try {
    storage.setItem(key, JSON.stringify(envelope));
    return true;
  } catch {
    return false; // quota or private mode: drafts are best-effort
  }
}

export function clearDraft(key: string, options: { storage?: DraftStorage | null } = {}): void {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  if (storage === null) return;
  try {
    storage.removeItem(key);
  } catch {
    // Best effort.
  }
}

/** Removes every draft (all users, all forms). Called on logout. */
export function clearAllDrafts(options: { storage?: DraftStorage | null } = {}): void {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  if (storage === null) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const name = storage.key(i);
      if (name !== null && name.startsWith(PREFIX)) keys.push(name);
    }
    for (const name of keys) storage.removeItem(name);
  } catch {
    // Best effort.
  }
}

/** "10:42" in Lagos time, for the restore banner. */
export function formatDraftTime(savedAt: number): string {
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(savedAt));
}
