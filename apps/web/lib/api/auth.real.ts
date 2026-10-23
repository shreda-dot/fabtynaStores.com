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

/**
 * The API writes every message on these two endpoints for the person reading
 * it ("This reset link is invalid or has expired…", "Password reset by email is
 * not available…"), so they are passed through instead of being re-worded here.
 */
function resetFailure(cause: unknown): AuthApiError {
  if (!(cause instanceof ApiError)) {
    return new AuthApiError("server", "Unable to reset the password. Please try again.");
  }
  if (cause.status === 429 || cause.kind === "rate-limited") {
    const delay = cause.retryAfterSeconds;
    return new AuthApiError(
      "rate-limited",
      delay === undefined
        ? "Too many requests. Please wait and try again."
        : `Too many requests. Try again in ${delay} seconds.`,
      delay,
    );
  }
  if (cause.code === "INVALID_RESET_TOKEN") {
    return new AuthApiError("invalid-token", cause.userMessage);
  }
  if (cause.kind === "network" || cause.kind === "non-json") {
    return new AuthApiError("network", "Could not reach the service. Check your connection and try again.");
  }
  if (cause.kind === "timeout" || cause.kind === "unknown-outcome") {
    return new AuthApiError("timeout", "The request timed out. Check your connection and try again.");
  }
  return new AuthApiError("server", cause.userMessage);
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
  async requestPasswordReset(email) {
    try {
      await requestJson<void>("/auth/forgot-password", {
        method: "POST",
        body: { email },
      });
    } catch (cause) {
      throw resetFailure(cause);
    }
  },
  async resetPassword(token, newPassword) {
    try {
      await requestJson<void>("/auth/reset-password", {
        method: "POST",
        body: { token, newPassword },
      });
    } catch (cause) {
      throw resetFailure(cause);
    }
  },
};
