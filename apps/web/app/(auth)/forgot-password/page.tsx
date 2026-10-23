"use client";

import { useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthApiError, authApi } from "@/lib/api";

/**
 * Asks for a reset link. The answer is the same whether or not the address
 * belongs to an admin — the API decides that, and this page must not undo it by
 * showing a different message.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
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
      await authApi.requestPasswordReset(email.trim());
      setSent(true);
    } catch (cause) {
      setError(
        cause instanceof AuthApiError
          ? cause.message
          : "Unable to send the reset link. Please try again.",
      );
    } finally {
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
            <h1 className="text-xl font-bold leading-tight tracking-tight">Forgot password</h1>
            <p className="text-sm text-muted-foreground">
              We will email you a link to choose a new one.
            </p>
          </div>
        </div>

        {sent ? (
          <div className="mt-4 space-y-3">
            <p className="flex items-start gap-2 rounded-md border border-border bg-background/50 px-3 py-2 text-sm">
              <MailCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                If that email belongs to an admin account, a reset link is on its way. It works once
                and expires in 30 minutes.
              </span>
            </p>
            <p className="text-sm text-muted-foreground">
              Nothing arrived? Check the spam folder, wait a minute, then try again.
            </p>
          </div>
        ) : (
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

            {error && (
              <p role="alert" className="text-sm font-medium text-danger">
                {error}
              </p>
            )}

            <Button type="submit" className="min-h-11 w-full text-base" loading={pending}>
              Email me a reset link
            </Button>
          </form>
        )}

        <Link
          href="/login"
          className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          Back to sign in
        </Link>
      </section>
    </main>
  );
}
