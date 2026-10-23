/**
 * The only email this API sends: the self-service password reset link.
 *
 * There is deliberately no mail library here — Resend has a plain HTTP endpoint
 * and Node 20 has a global `fetch`, so one call is enough. The API key is read
 * from the environment, sent as a bearer header, and never logged: a failure is
 * reported as a status code only, because the provider's error body can echo
 * the request back.
 */

export interface PasswordResetEmail {
  to: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export interface Mailer {
  sendPasswordReset(email: PasswordResetEmail): Promise<void>;
}

export interface ResendMailerConfig {
  apiKey: string;
  /** Verified sender, e.g. `Fabtyna Stores <no-reply@example.com>`. */
  from: string;
  /** Injected by tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export class MailSendError extends Error {
  constructor(readonly status: number) {
    // The status is enough to diagnose; never the key, the recipient or the body.
    super(`The mail provider rejected the message (status ${status}).`);
    this.name = "MailSendError";
  }
}

/**
 * Builds a mailer only when both values are present. `null` means
 * "forgot password" is switched off, which is a supported configuration: the
 * route answers 503 and the operator sees one warning at startup.
 */
export function mailerFromEnv(
  env: { resendApiKey: string | null; mailFrom: string | null },
  fetchImpl?: typeof fetch,
): Mailer | null {
  if (env.resendApiKey === null || env.mailFrom === null) return null;
  return createResendMailer({ apiKey: env.resendApiKey, from: env.mailFrom, fetchImpl });
}

export function createResendMailer(config: ResendMailerConfig): Mailer {
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 10_000;

  return {
    async sendPasswordReset({ to, resetUrl, expiresInMinutes }) {
      const response = await doFetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: config.from,
          to: [to],
          subject: "Reset your Fabtyna Stores password",
          text: resetEmailText(resetUrl, expiresInMinutes),
          html: resetEmailHtml(resetUrl, expiresInMinutes),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new MailSendError(response.status);
      }
    },
  };
}

export function resetEmailText(resetUrl: string, expiresInMinutes: number): string {
  return [
    "You asked to reset the password for your Fabtyna Stores admin account.",
    "",
    `Open this link to choose a new password (it expires in ${expiresInMinutes} minutes):`,
    resetUrl,
    "",
    "The link can be used once. If you did not ask for it, ignore this email —",
    "your current password still works.",
  ].join("\n");
}

export function resetEmailHtml(resetUrl: string, expiresInMinutes: number): string {
  const href = escapeHtml(resetUrl);
  return [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111827">',
    "<p>You asked to reset the password for your Fabtyna Stores admin account.</p>",
    `<p>Open this link to choose a new password (it expires in ${expiresInMinutes} minutes):</p>`,
    `<p><a href="${href}">Choose a new password</a></p>`,
    `<p style="font-size:13px;color:#6b7280">If the link does not open, paste this into your browser:<br>${href}</p>`,
    '<p style="font-size:13px;color:#6b7280">The link can be used once. If you did not ask for it, ignore this email — your current password still works.</p>',
    "</div>",
  ].join("");
}

/** The URL lands in an HTML attribute, so the five XML entities are escaped. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
