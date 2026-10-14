const DEMO_AUTH_KEY = "fabtyna-demo-session";

export function isDemoLoggedIn(): boolean {
  return (
    typeof window !== "undefined" &&
    window.sessionStorage.getItem(DEMO_AUTH_KEY) === "1"
  );
}

export function loginDemo(email: string, password: string): void {
  if (email.trim() === "" || password.trim() === "") {
    throw new Error("Enter an email and password to continue.");
  }
  window.sessionStorage.setItem(DEMO_AUTH_KEY, "1");
}

export function logoutDemo(): void {
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(DEMO_AUTH_KEY);
  }
}
