"use client";

import { Suspense, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, Info } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginDemo } from "@/lib/auth/demo-auth";
import { toast } from "@/stores/toast-store";

const DEFAULT_DESTINATION = "/dashboard";

/**
 * Only allow redirects to paths inside this app. Anything else (full URLs,
 * protocol-relative "//evil.com", backslash tricks, or the login page itself)
 * falls back to the dashboard.
 */
function safeDestination(raw: string | null): string {
  if (
    raw === null ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.startsWith("/\\") ||
    raw.startsWith("/login")
  ) {
    return DEFAULT_DESTINATION;
  }
  return raw;
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<main className="min-h-dvh bg-background" />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const destination = safeDestination(searchParams.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  // A ref guards against a double tap before React re-renders the disabled button.
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;

    setError("");
    submitting.current = true;
    setPending(true);

    try {
      // When real authentication replaces the demo, only this call changes.
      // Real auth should show one generic message ("Invalid email or password")
      // so the page never reveals which field was wrong.
      await loginDemo(email.trim(), password);
      router.replace(destination);
      // Stay in the loading state while the next page loads.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign in.");
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-4">
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-3">
          <svg
            aria-hidden="true"
            className="h-11 w-11 shrink-0 text-primary"
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect width="100" height="100" rx="20" fill="currentColor" />
            <path
              d="M28 28H58M28 28V72M28 50H50"
              className="stroke-primary-foreground"
              strokeWidth="10"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M72 38C72 32.4772 67.5228 28 62 28H52C46.4772 28 42 32.4772 42 38V38C42 43.5228 46.4772 48 52 48H62C67.5228 48 72 52.4772 72 58V58C72 63.5228 67.5228 68 62 68H52C46.4772 68 42 63.5228 42 58"
              className="stroke-primary-foreground"
              strokeWidth="10"
              strokeLinecap="round"
            />
          </svg>
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight tracking-tight">
              Fabtyna Stores
            </h1>
            <p className="text-sm text-muted-foreground">
              Sign in to the store admin workspace.
            </p>
          </div>
        </div>

        <p className="mt-3 flex items-center gap-2 rounded-md border border-border bg-background/50 px-3 py-2 text-xs text-muted-foreground">
          <Info aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          Demo sign-in only. Not real authentication yet.
        </p>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-sm font-medium">
              Email
            </label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              required
              autoComplete="username"
              placeholder="admin@fabtynastores.com"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (error) setError("");
              }}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="password" className="block text-sm font-medium">
                Password
              </label>
              {/* Negative margins keep the row compact while the tap area stays large. */}
              <button
                type="button"
                onClick={() =>
                  toast.info(
                    "Password reset is not ready yet. Please contact the store owner.",
                  )
                }
                className="-my-2.5 rounded-md px-1 py-2.5 text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Forgot password?
              </button>
            </div>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="pr-12"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (error) setError("");
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {showPassword ? (
                  <EyeOff aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <Eye aria-hidden="true" className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          )}

          <Button
            type="submit"
            className="min-h-11 w-full text-base"
            loading={pending}
          >
            Sign in
          </Button>
        </form>
      </section>
    </main>
  );
}