"use client";

import { Suspense, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthApiError, authApi } from "@/lib/api";

/** Same floor the API enforces (`MIN_PASSWORD_LENGTH` in the API's lib/password.ts). */
const MIN_PASSWORD_LENGTH = 12;

export default function ResetPasswordPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<main className="min-h-dvh bg-background" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState(false);
  // A ref guards against a double tap before React re-renders the disabled button.
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;

    setError("");
    setExpired(false);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Your new password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }

    submitting.current = true;
    setPending(true);
    try {
      await authApi.resetPassword(token, password);
      // Sign in again: resetting revoked every session this account had.
      router.replace("/login?reset=1");
      // Stay in the loading state while the next page loads.
    } catch (cause) {
      if (cause instanceof AuthApiError && cause.kind === "invalid-token") {
        setExpired(true);
        setError(cause.message);
      } else {
        setError(cause instanceof Error ? cause.message : "Unable to reset the password.");
      }
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-4">
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-white p-1 shadow-sm">
            <Image
              src="/fabtyna-logo.png"
              alt=""
              aria-hidden="true"
              width={48}
              height={48}
              priority
              className="h-full w-full rounded-lg object-contain"
            />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight tracking-tight">Choose a new password</h1>
            <p className="text-sm text-muted-foreground">
              This link works once, and then you sign in again.
            </p>
          </div>
        </div>

        {token === "" ? (
          <p role="alert" className="mt-4 rounded-md border border-border bg-background/50 px-3 py-2 text-sm">
            This reset link is incomplete. Please request a new one.
          </p>
        ) : (
          <form onSubmit={submit} className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="new-password" className="block text-sm font-medium">
                New password
              </label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  required
                  placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
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

            <div className="space-y-1.5">
              <label htmlFor="confirm-password" className="block text-sm font-medium">
                Confirm new password
              </label>
              <Input
                id="confirm-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  if (error) setError("");
                }}
              />
            </div>

            {error && (
              <p role="alert" className="text-sm font-medium text-danger">
                {error}
              </p>
            )}

            <Button type="submit" className="min-h-11 w-full text-base" loading={pending}>
              Save new password
            </Button>
          </form>
        )}

        <p className="mt-4 text-sm">
          <Link
            href={expired || token === "" ? "/forgot-password" : "/login"}
            className="inline-flex min-h-11 items-center gap-1.5 font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
            {expired || token === "" ? "Request a new link" : "Back to sign in"}
          </Link>
        </p>
      </section>
    </main>
  );
}
