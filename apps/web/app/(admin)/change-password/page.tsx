"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthApiError, authApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/stores/toast-store";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (newPassword.length < 12) {
      setError("Your new password must be at least 12 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }
    setPending(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      toast.success("Password changed. Other sessions have been signed out.");
      router.replace("/dashboard");
    } catch (cause) {
      if (cause instanceof AuthApiError && cause.kind === "network") {
        setError("Could not reach the sign-in service. Check your connection and try again.");
      } else {
        setError(cause instanceof Error ? cause.message : "Unable to change the password.");
      }
      setPending(false);
    }
  }

  return (
    <section className="mx-auto max-w-xl">
      <h2 className="text-2xl font-semibold">Change password</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Changing your password signs out your other sessions and keeps this one active.
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4 rounded-xl border border-border bg-card p-5">
        <div className="space-y-1.5">
          <label htmlFor="current-password" className="block text-sm font-medium">
            Current password
          </label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="new-password" className="block text-sm font-medium">
            New password
          </label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="confirm-password" className="block text-sm font-medium">
            Confirm new password
          </label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" loading={pending}>
          Update password
        </Button>
      </form>
    </section>
  );
}
