import {
  AuthApiError,
  type AuthApi,
  type AuthUser,
} from "./auth.api";

function apiUrl(path: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!baseUrl) {
    throw new AuthApiError("server", "The API URL is not configured.");
  }
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

async function request(
  path: string,
  options: { method: "GET" | "POST"; body?: unknown },
): Promise<Response> {
  const url = apiUrl(path);
  try {
    return await fetch(url, {
      method: options.method,
      credentials: "include",
      headers: options.body === undefined ? undefined : { "content-type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new AuthApiError(
      "network",
      "Could not reach the sign-in service. Check your connection and try again.",
    );
  }
}

async function assertSuccess(
  response: Response,
  options: { unauthorizedMessage?: string } = {},
): Promise<void> {
  if (response.ok) return;
  const retryAfterHeader = response.headers.get("retry-after");
  const parsedRetryAfter =
    retryAfterHeader === null ? undefined : Number.parseInt(retryAfterHeader, 10);
  if (response.status === 429) {
    const suffix =
      parsedRetryAfter === undefined || !Number.isFinite(parsedRetryAfter)
        ? ""
        : ` Try again in ${parsedRetryAfter} seconds.`;
    throw new AuthApiError(
      "rate-limited",
      `Too many sign-in attempts.${suffix}`,
      parsedRetryAfter,
    );
  }
  if (response.status === 401) {
    throw new AuthApiError(
      "invalid-credentials",
      options.unauthorizedMessage ?? "Email or password is incorrect.",
    );
  }
  const payload: unknown = await response.json().catch(() => null);
  const apiMessage =
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "object" &&
    payload.error !== null &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
      ? payload.error.message
      : "The request failed. Please try again.";
  throw new AuthApiError("server", apiMessage);
}

export const authRealApi: AuthApi = {
  mode: "real",
  async login(email, password) {
    const response = await request("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    await assertSuccess(response);
  },
  async logout() {
    const response = await request("/auth/logout", { method: "POST" });
    await assertSuccess(response);
  },
  async me() {
    const response = await request("/auth/me", { method: "GET" });
    await assertSuccess(response);
    return (await response.json()) as AuthUser;
  },
  async changePassword(currentPassword, newPassword) {
    const response = await request("/auth/change-password", {
      method: "POST",
      body: { currentPassword, newPassword },
    });
    await assertSuccess(response, { unauthorizedMessage: "Current password is incorrect." });
  },
};
