import { AuthApiError, type AuthApi, type AuthUser } from "./auth.api";
import { ApiError, requestJson } from "./client";

function authFailure(cause: unknown): AuthApiError {
  if (!(cause instanceof ApiError)) {
    return new AuthApiError("server", "Unable to sign in. Please try again.");
  }
  if (cause.status === 401 || cause.code === "INVALID_CREDENTIALS") {
    return new AuthApiError("invalid-credentials", "Email or password is incorrect.");
  }
  if (cause.status === 429 || cause.kind === "rate-limited") {
    const delay = cause.retryAfterSeconds;
    return new AuthApiError(
      "rate-limited",
      delay === undefined
        ? "Too many sign-in attempts. Please wait and try again."
        : `Too many sign-in attempts. Try again in ${delay} seconds.`,
      delay,
    );
  }
  if (cause.kind === "network" || cause.kind === "non-json") {
    return new AuthApiError("network", "Could not reach the sign-in service.");
  }
  if (cause.kind === "timeout" || cause.kind === "unknown-outcome") {
    return new AuthApiError("timeout", "The sign-in request timed out. Please try again.");
  }
  return new AuthApiError("server", "Unable to sign in. Please try again.");
}

export const authRealApi: AuthApi = {
  mode: "real",
  async login(email, password) {
    try {
      await requestJson<void>("/auth/login", {
        method: "POST",
        body: { email, password },
      });
    } catch (cause) {
      throw authFailure(cause);
    }
  },
  async logout() {
    await requestJson<void>("/auth/logout", { method: "POST" });
  },
  async me() {
    return requestJson<AuthUser>("/auth/me", { method: "GET" });
  },
  async changePassword(currentPassword, newPassword) {
    await requestJson<void>("/auth/change-password", {
      method: "POST",
      body: { currentPassword, newPassword },
    });
  },
};
