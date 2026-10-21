import { useNetworkStore } from "@/stores/network-store";

export type ApiErrorKind =
  | "network"
  | "timeout"
  | "validation"
  | "not-found"
  | "unauthorized"
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

  constructor(
    kind: ApiErrorKind,
    userMessage: string,
    options?: { cause?: unknown; detail?: string; status?: number },
  ) {
    super(userMessage, { cause: options?.cause });
    this.name = "ApiError";
    this.kind = kind;
    this.userMessage = userMessage;
    this.detail = options?.detail;
    this.status = options?.status;
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
      useNetworkStore.getState().recordFailure();
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
