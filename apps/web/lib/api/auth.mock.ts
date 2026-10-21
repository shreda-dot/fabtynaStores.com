import {
  isDemoLoggedIn,
  loginDemo,
  logoutDemo,
} from "@/lib/auth/demo-auth";
import { AuthApiError, type AuthApi, type AuthUser } from "./auth.api";

const demoUser: AuthUser = {
  id: "demo-admin",
  email: "admin@demo.local",
};

export const authMockApi: AuthApi = {
  mode: "mock",
  async login(email, password) {
    loginDemo(email, password);
  },
  async logout() {
    logoutDemo();
  },
  async me() {
    if (!isDemoLoggedIn()) {
      throw new AuthApiError("invalid-credentials", "Sign in to continue.");
    }
    return demoUser;
  },
  async changePassword() {
    throw new Error("Password changes are available only with real authentication.");
  },
};
