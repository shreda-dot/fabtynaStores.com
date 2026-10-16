"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { loginDemo } from "@/lib/auth/demo-auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      loginDemo(email, password);
      router.replace("/dashboard");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to log in.");
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-8">
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        {/* Brand Logo & Header */}
        <div className="flex flex-col items-center text-center sm:items-start sm:text-left">
          <div className="flex items-center gap-3">
            {/* Custom FS Logo Mark */}
            <svg
              className="h-10 w-10 text-primary"
              viewBox="0 0 100 100"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect width="100" height="100" rx="20" fill="currentColor" />
              <path
                d="M28 28H58M28 28V72M28 50H50"
                stroke="white"
                strokeWidth="10"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M72 38C72 32.4772 67.5228 28 62 28H52C46.4772 28 42 32.4772 42 38V38C42 43.5228 46.4772 48 52 48H62C67.5228 48 72 52.4772 72 58V58C72 63.5228 67.5228 68 62 68H52C46.4772 68 42 63.5228 42 58"
                stroke="white"
                strokeWidth="10"
                strokeLinecap="round"
              />
            </svg>
            <h1 className="text-2xl font-bold tracking-tight">Fabtyna Stores</h1>
          </div>
          
          <p className="mt-3 text-sm text-muted-foreground">
            Sign in to the store admin workspace.
          </p>
        </div>

        {/* Notice */}
        <p className="mt-5 rounded-md border border-border bg-muted px-3 py-3 text-sm text-muted-foreground">
          Demo login: not real authentication
        </p>

        {/* Form */}
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              inputMode="email"
              required
              autoComplete="username"
              placeholder="admin@fabtynastores.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="min-h-12 w-full rounded-md border border-input bg-background px-3 text-base outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="min-h-12 w-full rounded-md bg-primary px-4 text-base font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Continue to demo
          </button>
        </form>
      </section>
    </main>
  );
}