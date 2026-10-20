/**
 * Transaction timing for the write endpoints. Prisma's default 5 s is too short
 * for Neon, so these are explicit and can be overridden from the environment
 * (API_TX_TIMEOUT_MS, API_TX_MAX_WAIT_MS, API_LOCK_TIMEOUT_MS).
 *
 * `lockTimeoutMs` must stay below `timeoutMs`: a request waiting on someone
 * else's row lock should fail with a clean 503 before Prisma kills the whole
 * transaction.
 */
export interface TxTimeouts {
  /** Maximum lifetime of one interactive transaction. */
  timeoutMs: number;
  /** Maximum wait to obtain a connection from the pool. */
  maxWaitMs: number;
  /** `SET LOCAL lock_timeout`: maximum wait for any single row lock. */
  lockTimeoutMs: number;
}

export const DEFAULT_TX_TIMEOUTS: TxTimeouts = {
  timeoutMs: 20_000,
  maxWaitMs: 10_000,
  lockTimeoutMs: 15_000,
};
