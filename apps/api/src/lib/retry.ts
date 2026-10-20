import { isRetryableError } from "./errors.js";

export interface RetryOptions {
  /** Retries after the first attempt (so the operation runs at most 1 + maxRetries times). */
  maxRetries?: number;
  /** Called before each retry, e.g. to log it. */
  onRetry?: (attempt: number, error: unknown) => void;
  /** Overridable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Re-runs `operation` when the database reports a deadlock (40P01) or a
 * serialization failure (40001). Each attempt must be a whole transaction, so a
 * retry never repeats half of one. A small random pause keeps two colliding
 * requests from colliding again in lock-step. Any other error, and the last
 * retryable one, is thrown to the caller.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= maxRetries || !isRetryableError(error)) {
        throw error;
      }
      options.onRetry?.(attempt + 1, error);
      await sleep(20 + Math.floor(Math.random() * 60));
    }
  }
}
