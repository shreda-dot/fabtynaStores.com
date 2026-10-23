export interface AuthUser {
  id: string;
  email: string;
}

export type AuthFailureKind =
  | "invalid-credentials"
  | "invalid-token"
  | "rate-limited"
  | "network"
  | "timeout"
  | "server";

export class AuthApiError extends Error {
  constructor(
    readonly kind: AuthFailureKind,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AuthApiError";
  }
}

export interface AuthApi {
  readonly mode: "mock" | "real";
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  me(): Promise<AuthUser>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  /** Asks for a reset link. Resolves even for an unknown address (no enumeration). */
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(token: string, newPassword: string): Promise<void>;
}
