import { useNetworkStore } from "@/stores/network-store";

export type ApiErrorKind =
  | "network"
  | "timeout"
  | "unknown-outcome"
  | "non-json"
  | "server"
  | "rate-limited"
  | "validation"
  | "not-found"
  | "unauthorized"
  | "configuration"
  | "not-connected"
  | "unknown";

/**
 * Every failure surfaced by the API layer is normalised into this type so the
 * UI can show a user-readable message and decide whether to retry.
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly userMessage: string;
  readonly detail: string | undefined;
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly details: unknown;
  readonly retryAfterSeconds: number | undefined;
  readonly retryable: boolean;

  constructor(
    kind: ApiErrorKind,
    userMessage: string,
    options?: {
      cause?: unknown;
      detail?: string;
      status?: number;
      code?: string;
      details?: unknown;
      retryAfterSeconds?: number;
      retryable?: boolean;
    },
  ) {
    super(userMessage, { cause: options?.cause });
    this.name = "ApiError";
    this.kind = kind;
    this.userMessage = userMessage;
    this.detail = options?.detail;
    this.status = options?.status;
    this.code = options?.code;
    this.details = options?.details;
    this.retryAfterSeconds = options?.retryAfterSeconds;
    this.retryable = options?.retryable ?? false;
  }
}

class TimeoutError extends Error {}

const DEFAULT_TIMEOUT_MS = toPositiveNumber(
  process.env.NEXT_PUBLIC_API_TIMEOUT_MS,
  15_000,
);

function toPositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Human-readable message for any thrown value. Never leaks a stack trace. */
export function toUserMessage(cause: unknown): string {
  if (cause instanceof ApiError) return cause.userMessage;
  if (cause instanceof Error && cause.message.trim() !== "") return cause.message.trim();
  return "Something went wrong. Please try again.";
}

/** Technical detail, only ever surfaced in development / collapsed UI. */
export function toTechnicalDetail(cause: unknown): string | undefined {
  if (cause instanceof ApiError) return cause.detail;
  if (cause instanceof Error) return cause.stack ?? cause.message;
  return undefined;
}

export function apiFieldErrors(cause: unknown): Record<string, string> {
  if (!(cause instanceof ApiError) || cause.details === undefined) return {};
  const details = cause.details;
  const candidates = Array.isArray(details)
    ? details
    : isRecord(details) && Array.isArray(details.issues)
      ? details.issues
      : [];
  const result: Record<string, string> = {};
  for (const item of candidates) {
    if (!isRecord(item) || typeof item.message !== "string") continue;
    const path = Array.isArray(item.path)
      ? item.path.filter((part): part is string | number => typeof part === "string" || typeof part === "number").join(".")
      : typeof item.path === "string"
        ? item.path
        : "";
    if (path) result[path] = item.message;
  }
  if (isRecord(details) && typeof details.field === "string" && typeof details.message === "string") {
    result[details.field] = details.message;
  }
  return result;
}

function classifyError(cause: unknown): ApiError {
  if (cause instanceof ApiError) {
    if (cause.status === 401 || cause.kind === "unauthorized") {
      return new ApiError("unauthorized", "Your session has expired. Sign in again.", {
        cause,
        status: 401,
      });
    }
    return cause;
  }
  const status =
    typeof cause === "object" && cause !== null && "status" in cause &&
    typeof cause.status === "number"
      ? cause.status
      : undefined;
  if (status === 401) {
    return new ApiError("unauthorized", "Your session has expired. Sign in again.", {
      cause,
      status,
    });
  }
  if (cause instanceof TimeoutError) {
    return new ApiError(
      "timeout",
      "The request took too long. Please check your connection and try again.",
      { cause },
    );
  }
  if (cause instanceof DOMException && cause.name === "AbortError") {
    return new ApiError(
      "timeout",
      "The request took too long. Please check your connection and try again.",
      { cause },
    );
  }
  if (cause instanceof TypeError) {
    return new ApiError(
      "network",
      "Network problem. Check your connection and try again.",
      { cause },
    );
  }
  if (cause instanceof Error) {
    const message = cause.message.trim() || "Something went wrong. Please try again.";
    if (/not found/i.test(message)) {
      return new ApiError("not-found", message, { cause, detail: cause.stack });
    }
    return new ApiError("unknown", message, { cause, detail: cause.stack });
  }
  return new ApiError("unknown", "Something went wrong. Please try again.", { cause });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new TimeoutError("Request timed out.")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function recordHealthy(durationMs: number): void {
  if (typeof window === "undefined") return;
  useNetworkStore.getState().recordSuccess(durationMs);
}

function recordFailure(): void {
  if (typeof window === "undefined") return;
  useNetworkStore.getState().recordFailure();
}

const DEFAULT_READ_TIMEOUT_MS = toPositiveNumber(
  process.env.NEXT_PUBLIC_API_READ_TIMEOUT_MS,
  10_000,
);
const TX_TIMEOUT_MS = toPositiveNumber(
  process.env.NEXT_PUBLIC_API_TX_TIMEOUT_MS,
  20_000,
);
const TX_MAX_WAIT_MS = toPositiveNumber(
  process.env.NEXT_PUBLIC_API_TX_MAX_WAIT_MS,
  10_000,
);
const LOCK_TIMEOUT_MS = toPositiveNumber(
  process.env.NEXT_PUBLIC_API_LOCK_TIMEOUT_MS,
  15_000,
);
const MAX_TX_RETRIES = 3;
const MAX_RETRY_BACKOFF_MS = 80;
const MAX_TX_ATTEMPTS = MAX_TX_RETRIES + 1;
const DEFAULT_WRITE_TIMEOUT_MS =
  MAX_TX_ATTEMPTS * (TX_MAX_WAIT_MS + Math.max(TX_TIMEOUT_MS, LOCK_TIMEOUT_MS)) +
  MAX_TX_RETRIES * MAX_RETRY_BACKOFF_MS +
  1_000;

type JsonRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  timeoutMs?: number;
};

function apiBaseUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!baseUrl) {
    throw new ApiError("configuration", "The API URL is not configured.");
  }
  return baseUrl.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (raw === null) return undefined;
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function emitUnauthorized(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("fabtyna:unauthorized"));
  }
}

function unknownWriteOutcome(cause: unknown, hasIdempotencyKey: boolean): ApiError {
  const userMessage = hasIdempotencyKey
    ? "We could not confirm whether this change completed. Check the page before retrying; a retry will reuse the same request key."
    : "We could not confirm whether this change completed. Check its result before trying again.";
  return new ApiError("unknown-outcome", userMessage, { cause });
}

function networkError(cause: unknown, write: boolean, hasIdempotencyKey: boolean): ApiError {
  if (write) {
    return unknownWriteOutcome(cause, hasIdempotencyKey);
  }
  return new ApiError("network", "Network problem. Check your connection and try again.", {
    cause,
  });
}

async function fetchOnce<T>(
  path: string,
  options: JsonRequestOptions,
): Promise<T> {
  const method = options.method ?? "GET";
  const isWrite = method !== "GET";
  const url = `${apiBaseUrl()}${path}`;
  const controller = new AbortController();
  const timeoutMs =
    options.timeoutMs ??
    (isWrite ? DEFAULT_WRITE_TIMEOUT_MS : DEFAULT_READ_TIMEOUT_MS);
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        credentials: "include",
        headers: {
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
          ...(options.idempotencyKey === undefined
            ? {}
            : { "Idempotency-Key": options.idempotencyKey }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: controller.signal,
      });
    } catch (cause) {
      if (controller.signal.aborted) {
        throw isWrite
          ? unknownWriteOutcome(cause, options.idempotencyKey !== undefined)
          : new ApiError("timeout", "The request took too long. Please try again.", { cause });
      }
      throw networkError(cause, isWrite, options.idempotencyKey !== undefined);
    }

    if (response.status === 401) {
      const parsed = await response.json().catch(() => null);
      const error = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : null;
      const apiError = new ApiError(
        "unauthorized",
        typeof error?.message === "string"
          ? error.message
          : "Your session has expired. Sign in again.",
        {
          status: 401,
          code: typeof error?.code === "string" ? error.code : "UNAUTHENTICATED",
          details: error?.details,
        },
      );
      throw apiError;
    }

    const text = await response.text();
    let payload: unknown;
    if (text !== "") {
      try {
        payload = JSON.parse(text) as unknown;
      } catch (cause) {
        throw new ApiError(
          "non-json",
          "The server returned an unreadable response. Please try again.",
          {
            cause,
            status: response.status,
            retryable: response.status === 503,
          },
        );
      }
    }

    if (response.status >= 500) {
      throw new ApiError(
        "server",
        response.status === 503
          ? "The service is temporarily unavailable. Please try again."
          : "The service could not complete the request. Please try again.",
        { status: response.status, code: "SERVER_ERROR", retryable: response.status === 503 },
      );
    }

    if (!response.ok) {
      const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
      const status = response.status;
      const kind: ApiErrorKind =
        status === 429
          ? "rate-limited"
          : status === 400 || status === 422
            ? "validation"
            : status === 404
              ? "not-found"
              : "unknown";
      const retryAfter = retryAfterSeconds(response);
      throw new ApiError(
        kind,
        status === 429
          ? "Too many requests. Please wait before trying again."
          : typeof error?.message === "string"
            ? error.message
            : "The request could not be completed.",
        {
          status,
          code: typeof error?.code === "string" ? error.code : undefined,
          details: error?.details,
          retryAfterSeconds: retryAfter,
          retryable: status === 429 || status === 503,
        },
      );
    }

    if (response.status === 204) {
      recordHealthy(Date.now() - startedAt);
      return undefined as T;
    }
    if (payload === undefined) {
      throw new ApiError("non-json", "The server returned an empty response.", {
        status: response.status,
      });
    }
    recordHealthy(Date.now() - startedAt);
    return payload as T;
  } catch (cause) {
    if (cause instanceof ApiError) {
      if (cause.kind === "network" || cause.kind === "timeout" || cause.kind === "unknown-outcome") {
        recordFailure();
      }
      if (cause.kind === "unauthorized") emitUnauthorized();
      throw cause;
    }
    throw new ApiError("unknown", "Something went wrong. Please try again.", { cause });
  } finally {
    clearTimeout(timer);
  }
}

export async function requestJson<T>(
  path: string,
  options: JsonRequestOptions = {},
): Promise<T> {
  const method = options.method ?? "GET";
  try {
    return await fetchOnce<T>(path, options);
  } catch (cause) {
    if (method === "GET" && cause instanceof ApiError && cause.kind === "network") {
      return fetchOnce<T>(path, options);
    }
    throw cause;
  }
}

export function createNotConnectedError(): ApiError {
  return new ApiError("not-connected", "Not connected to the real API yet.");
}

/**
 * Wraps a single API call with a timeout, typed errors and request-health
 * reporting for the network status bar. Always resolves through `finally` so
 * loading state cannot get stuck.
 */
export async function apiRequest<T>(
  run: () => Promise<T>,
  options?: { timeoutMs?: number },
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();
  try {
    const result = await withTimeout(run(), timeoutMs);
    recordHealthy(Date.now() - startedAt);
    return result;
  } catch (cause) {
    const error = classifyError(cause);
    if (error.kind === "unauthorized" && typeof window !== "undefined") {
      window.dispatchEvent(new Event("fabtyna:unauthorized"));
    }
    if (error.kind === "network" || error.kind === "timeout") {
      recordFailure();
    }
    throw error;
  }
}

/**
 * Wraps every function-valued property of an API object so all calls share the
 * timeout / typed-error / health-reporting behaviour. The object shape is
 * preserved exactly.
 */
export function instrumentApi<T extends object>(api: T): T {
  const wrapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(api)) {
    wrapped[key] =
      typeof value === "function"
        ? (...args: unknown[]) =>
            apiRequest(() =>
              (value as (...inner: unknown[]) => Promise<unknown>)(...args),
            )
        : value;
  }
  return wrapped as T;
}
