export type IdempotencyIntent = {
  getKey(): string;
  markSucceeded(): void;
  reset(): void;
};

export function createIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

export function createIdempotencyIntent(
  makeKey: () => string = createIdempotencyKey,
): IdempotencyIntent {
  let key: string | undefined;
  return {
    getKey() {
      key ??= makeKey();
      return key;
    },
    markSucceeded() {
      key = undefined;
    },
    reset() {
      key = undefined;
    },
  };
}
